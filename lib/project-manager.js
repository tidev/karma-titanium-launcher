'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function ProjectManager(logger) {
    this.logger = logger.create('ti.project');
    this.tiBinaryPath = null;
    this.projectPath = null;
    this.projectPrepared = false;
    this.isStandaloneProject = false;
}

ProjectManager.prototype.prepareProject = function(options) {
    return Promise.resolve()
        .then(() => {
            if (this.isProjectDirectory()) {
                return this.prepareAppProject(options);
            } else {
                return this.prepareStandaloneRunner(options);
            }
        })
        .then(() => this.writeConfiguration(options.client))
        .then(() => {
            this.projectPrepared = true
        });
}

ProjectManager.prototype.isProjectDirectory = function() {
    const tiAppXmlPath = path.join(process.cwd(), 'tiapp.xml');
    return fs.existsSync(tiAppXmlPath);
}

ProjectManager.prototype.prepareAppProject = function(options) {
    this.logger.debug('Titanium app project detected, injecting Karma runner');
}

ProjectManager.prototype.prepareStandaloneRunner = function(options) {
    this.logger.debug('Not a Titanium project directory, creating standalone Karma runner');
    const projectName = 'karma-runner';
    return this.executeCommand('titanium', [
        'create',
        '--id', 'ti.karma.runner',
        '-n', projectName,
        '-t', 'app',
        '-u', 'localhost',
        '-d', options.tempPath,
        '-p', options.platform,
        '--force',
        '--no-prompt',
        '--no-progress-bars',
        '--no-colors'
    ]).then(() => {
        this.projectPath = path.join(options.tempPath, projectName);
    }).then(() => {
        
    });
}

ProjectManager.prototype.executeTiCommand = function(command, args) {
    this.logger.debug(`Running command: ${command}  ${args.join(' ')}`);
    
    return new Promise((resolve, reject) => {
        const child = spawn(command, args);

        child.on('close', function (code) {
            if (code) {
                logger.error(`${command} exited with exit code ${code}`);
                reject(new Error(`Failed to execute command during project prepartion step. The command was: ${command} ${args.join(' ')}`));
            }

            resolve();
        });
    });
}

ProjectManager.prototype.writeConfiguration = function(clientOptions) {
    const configPath = path.join(this.projectPath, 'Resources', 'config.js');
    let config = `export default ${JSON.stringify(clientOptions)};`;
    return new Promise((resolve, reject) => {
        this.logger.debug(`Writing Karma client config to ${configPath}\n${config}`);
        fs.writeFile(configPath, config, err => {
            if (err) {
                reject(err);
            }

            resolve();
        })
    });
}

ProjectManager.prototype.cleanUp = function() {

}

module.exports = ProjectManager;
