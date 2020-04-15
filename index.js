'use strict';

const _ = require('lodash');

class AwsAlbAlias {
    constructor(serverless, options) {
        this._serverless = serverless;
        this._options = options || {};
        this._provider = this._serverless.getProvider('aws');

        this._stage = this._provider.getStage();
        this._alias = this._options.alias || this._stage;
        this._serverless.service.provider.alias = this._alias;

        this.hooks = {

            'before:aws:deploy:deploy:createStack': () => {

                const stageStack = this._serverless.service.provider.compiledCloudFormationTemplate;
                const aliasStack = this._serverless.service.provider.compiledCloudFormationAliasTemplate;
                this._masterAlias = stageStack.Outputs.MasterAliasName.Value
                this._alias = this._options.alias || this._masterAlias;

                this._serverless.cli.log(
                    "Moving alb to alias stack ...");
                const aliasResources = [];

                //find alias to use later for depend on
                const aliases =
                    _.assign({},
                        _.pickBy(
                            aliasStack.Resources, ['Type','AWS::Lambda::Alias']
                        ));

                //find lambda target groups
                const targetGroups =
                    _.assign({},
                        _.pickBy(
                            _.pickBy(stageStack.Resources,
                                ['Type', 'AWS::ElasticLoadBalancingV2::TargetGroup']),
                            ['Properties.TargetType', 'lambda']));

                _.forOwn(targetGroups, (targetGroup, name) => {
                    const importValue = _.valuesIn(_.pickBy(stageStack.Outputs,['Value', targetGroup.Properties.Targets[0].Id]))[0].Export.Name
                    const dependsOn = _.pickBy(aliases,['Properties.FunctionName.Fn::ImportValue', importValue])

                    targetGroup.DependsOn.push(_.keys(dependsOn)[0]);

                    targetGroup.Properties.Targets[0].Id = {
                        'Fn::Join': [':',
                            [{'Fn::ImportValue': importValue},
                                this._masterAlias]]
                    };
                    delete stageStack.Resources[name];
                });

                //Find alb rules
                const albRules =
                    _.assign({},
                        _.pickBy(stageStack.Resources,
                            ['Type', 'AWS::ElasticLoadBalancingV2::ListenerRule']));

                _.forOwn(albRules, (albRule, name) => {
                    delete stageStack.Resources[name];
                });

                // find alb permissions
                const albPermissions =
                    _.assign({},
                        _.pickBy(
                            _.pickBy(stageStack.Resources,
                                ['Type', 'AWS::Lambda::Permission']),
                            ['Properties.Principal',
                                'elasticloadbalancing.amazonaws.com']));

                _.forOwn(albPermissions, (albPermission, name) => {
                    const importValue = _.valuesIn(_.pickBy(stageStack.Outputs,['Value', albPermission.Properties.FunctionName]))[0].Export.Name
                    const dependsOn = _.pickBy(aliases,['Properties.FunctionName.Fn::ImportValue', importValue])

                    albPermission.DependsOn = _.keys(dependsOn)[0]

                    albPermission.Properties.FunctionName = {
                        'Fn::Join': [':',
                            [{'Fn::ImportValue': importValue},
                                this._masterAlias]]
                    };
                    delete stageStack.Resources[name];
                });

                // Add all alias stack owned resources
                aliasResources.push(targetGroups);
                aliasResources.push(albRules);
                aliasResources.push(albPermissions);

                if (this._masterAlias !== this._alias) {
                    this._serverless.cli.log(
                        "Moving alb to alias only works for master alias");
                    return;
                }

                _.forEach(aliasResources,
                    resource => _.assign(aliasStack.Resources, resource));

                this._serverless.cli.log(
                    "Moving alb to alias stack finished.");
            }
        };

    }
}

module.exports = AwsAlbAlias;
