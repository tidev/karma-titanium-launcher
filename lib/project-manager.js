'use strict';

const axios = require('axios');
const extract = require('extract-zip');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const socketIoUrl = {
	ios: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/ios-1.0.1/ti.socketio-iphone-1.0.1.zip',
	android: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/android-1.0.1/ti.socketio-android-1.0.1.zip'
};

function ProjectManager(logger) {
	this.logger = logger.create('ti.project');
	this.tiBinaryPath = null;
	this.projectPath = null;
	this.projectPrepared = false;
	this.isStandaloneProject = false;
	this.createdFiles = [];
}

ProjectManager.prototype.prepareProject = function (options) {
	this.options = options;

	if (this.projectPrepared) {
		return Promise.resolve();
	}

	return Promise.resolve()
		.then(() => {
			if (this.isProjectDirectory()) {
				return this.prepareAppProject();
			} else {
				return this.prepareStandaloneRunner();
			}
		})
		.then(() => this.downloadAndInstallSocketIoModule())
		.then(() => this.writeConfiguration())
		.then(() => this.installProjectHook())
		.then(() => {
			if (this.isProjectDirectory()) {
				this.projectPrepared = true;
			}
		});
};

ProjectManager.prototype.isProjectDirectory = function isProjectDirectory() {
	if (isProjectDirectory.result) {
		return isProjectDirectory.result;
	}
	const tiAppXmlPath = path.join(process.cwd(), 'tiapp.xml');
	const result = fs.existsSync(tiAppXmlPath);
	isProjectDirectory.result = result;

	return result;
};

ProjectManager.prototype.prepareAppProject = function () {
	this.logger.debug('Titanium app project detected, injecting Karma runner');
	return Promise.reject('Not implemented yet!');
};

ProjectManager.prototype.prepareStandaloneRunner = function () {
	this.logger.debug('Not Titanium project directory, creating standalone Karma runner');
	const projectName = 'karma-runner';
	const args = [
		'create',
		'--id', 'ti.karma.runner',
		'-n', projectName,
		'-t', 'app',
		'-u', 'localhost',
		'-d', this.options.tempPath,
		'-p', this.options.platform,
		'--force',
		'--no-prompt',
		'--no-progress-bars',
		'--no-colors'
	];
	if (this.options.sdkVersion) {
		args.push('-s', this.options.sdkVersion);
	}
	return this.executeCommand('titanium', args)
		.then(() => {
			this.projectPath = path.join(this.options.tempPath, projectName);
		}).then(() => {
			return this.executeCommand('npm', [
				'i', /* 'titanium-karma-client' */ '/Users/jvennemann/Development/appc/titanium-karma-client',
				'--production'
			], { cwd: path.join(this.projectPath, 'Resources') });
		});
};

ProjectManager.prototype.executeCommand = function (command, args, options) {
	this.logger.debug(`Running command: ${command}  ${args.join(' ')}`);

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, options);

		child.on('close', code => {
			if (code) {
				this.logger.error(`${command} exited with non-zero code ${code}`);
				reject(new Error(`Failed to execute command during project prepartion step. The command was: ${command} ${args.join(' ')}`));
			}

			resolve();
		});
	});
};

ProjectManager.prototype.writeConfiguration = function () {
	const configPath = path.join(this.projectPath, 'Resources', 'config.js');
	let config = `export default ${JSON.stringify(this.options.client)};`;

	this.logger.debug(`Writing Karma client config to ${configPath}\n${config}`);
	return fs.outputFile(configPath, config);
};

ProjectManager.prototype.downloadAndInstallSocketIoModule = function () {
	const platform = this.options.platform;
	this.logger.debug(`Downloading module ti.socketio for platform ${platform}`);
	const downloadDestPath = path.join(this.options.tempPath, 'ti.socketio.zip');
	const destStream = fs.createWriteStream(downloadDestPath);
	return axios.get(socketIoUrl[platform], {
		responseType: 'stream'
	}).then(response => {
		return new Promise((resolve, reject) => {
			response.data.pipe(destStream);
			destStream.on('finish', () => {
				destStream.close(() => resolve(downloadDestPath));
			});
			destStream.on('error', err => reject(err));
		});
	}).then((moduleZipPath) => {
		return new Promise((resolve, reject) => {
			extract(moduleZipPath, { dir: this.projectPath }, err => {
				if (err) {
					reject(err);
				}

				resolve();
			});
		});
	});
};

ProjectManager.prototype.installProjectHook = function () {
	this.logger.debug('Installing temporary project hook');
	const hookSourcePath = path.join(__dirname, '..', 'templates', 'hooks.js');
	const hookDestPath = path.join(this.projectPath, 'hooks', 'karma.tmp.js');
	return fs.ensureDir(path.dirname(hookDestPath))
		.then(() => fs.copy(hookSourcePath, hookDestPath))
		.then(() => this.createdFiles.push(hookDestPath));
};

ProjectManager.prototype.cleanUp = function () {
	this.logger.debug('Undoing changes made to project');
	for (const fileToDelete of this.createdFiles) {
		this.logger.debug(`  Deleting ${fileToDelete}`);
		fs.removeSync(fileToDelete);
	}
};

module.exports = ProjectManager;
