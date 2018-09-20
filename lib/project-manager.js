'use strict';

const axios = require('axios');
// eslint-disable-next-line security/detect-child-process
const { spawn } = require('child_process');
const crypto = require('crypto');
const extract = require('extract-zip');
const fs = require('fs-extra');
const path = require('path');
const which = require('which');

const socketIoModules = {
	ios: {
		url: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/ios-1.0.1/ti.socketio-iphone-1.0.1.zip',
		sha1: 'e77f030c3ff1d9b78f0c10ab09dec017962bdb79'
	},
	android: {
		url: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/android-1.0.1/ti.socketio-android-1.0.1.zip',
		sha1: 'b0dfda8688bf12f326f55cb83b03d2c082cf5f08'
	}
};

function ProjectManager(logger) {
	this.logger = logger.create('ti.project');
	this.tiBinaryPath = null;
	this.projectPath = null;
	this.projectPrepared = false;
	this.isStandaloneProject = false;
	this.createdFiles = [];
	this.dataDirectoryPath = path.join(__dirname, '..', 'data');
}

ProjectManager.prototype.prepareProject = function (options) {
	this.options = options;

	if (this.projectPrepared) {
		return Promise.resolve();
	}

	return Promise.resolve()
		.then(() => this.ensureSdkIsInstalled())
		.then(() => {
			if (this.isProjectDirectory()) {
				return this.prepareAppProject();
			} else {
				return this.prepareStandaloneRunner();
			}
		})
		.then(() => this.downloadAndInstallSocketIoModule())
		.then(() => this.installProjectHook())
		.then(() => {
			if (this.isProjectDirectory()) {
				this.projectPrepared = true;
			}
		})
		.catch(err => {
			console.log(err);
			throw err;
		});
};

ProjectManager.prototype.ensureSdkIsInstalled = function ensureSdkIsInstalled() {
	if (!this.options.sdkVersion) {
		return Promise.resolve();
	}

	return this.executeCommand('titanium', [ 'sdk', 'list', '-o', 'json' ])
		.then(result => {
			let sdkList;
			try {
				sdkList = JSON.parse(result);
			} catch (e) {
				return Promise.reject(new Error('Failed to parse SDK list.'));
			}
			if (sdkList.installed[this.options.sdkVersion]) {
				this.logger.debug(`Configured SDK version ${this.options.sdkVersion} is installed.`);
				return Promise.resolve();
			} else {
				this.logger.debug(`Configured SDK version ${this.options.sdkVersion} is not installed, starting download ...`);
				return this.executeCommand('titanium', [ 'sdk', 'install', this.options.sdkVersion ]);
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
	this.projectPath = process.cwd();

	if (this.options.projectType === 'alloy') {
		this.detectAlloyPath();
	}

	return Promise.resolve();
};

ProjectManager.prototype.prepareStandaloneRunner = function () {
	this.logger.debug('No Titanium project directory, creating standalone Karma runner');
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
		});
};

ProjectManager.prototype.executeCommand = function (command, args, options) {
	this.logger.debug(`Running command: ${command} ${args.join(' ')}`);

	return new Promise((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		const child = spawn(command, args, options);

		child.on('close', code => {
			if (code) {
				this.logger.error(`${command} exited with non-zero code ${code}`);
				this.logger.error(`stdout: ${stdout}`);
				this.logger.error(`stderr: ${stderr}`);
				reject(new Error(`Failed to execute command during project prepartion step. The command was: ${command} ${args.join(' ')}`));
			}

			resolve(stdout);
		});

		child.stdout.on('data', data => {
			stdout += data.toString();
		});
		child.stderr.on('data', data => {
			stderr += data.toString();
		});
		child.on('error', reject);
	});
};

ProjectManager.prototype.downloadAndInstallSocketIoModule = function () {
	const platform = this.options.platform;
	const socketIoModulePath = path.join(this.projectPath, 'modules', platform === 'ios' ? 'iphone' : platform, 'ti.socketio');
	if (fs.existsSync(socketIoModulePath)) {
		this.logger.debug('Socket.io module already present, skipping install.');
		return Promise.resolve();
	}

	const socketIoModule = socketIoModules[platform];
	const downloadDestPath = this.getDownloadPath(socketIoModule);
	return this.hasLocalCopy(socketIoModule)
		.then(hasLocalCopy => {
			if (hasLocalCopy) {
				return downloadDestPath;
			} else {
				this.logger.debug(`Downloading module ti.socketio for platform ${platform} to ${downloadDestPath}`);
				return this.downloadModule(socketIoModule, downloadDestPath);
			}
		})
		.then(moduleArchivePath => {
			return new Promise((resolve, reject) => {
				this.logger.debug('Installing ti.socketio module');
				extract(moduleArchivePath, {
					dir: this.projectPath
				}, err => {
					if (err) {
						reject(err);
					}

					this.createdFiles.push(path.join(this.projectPath, 'modules', 'ti.socketio'));

					resolve();
				});
			});
		});
};

ProjectManager.prototype.hasLocalCopy = function (socketIoModule) {
	const expectedHash = socketIoModule.sha1;
	const moduleArchivePath = this.getDownloadPath(socketIoModule);

	return fs.pathExists(moduleArchivePath)
		.then(moduleArchiveExists => {
			if (!moduleArchiveExists) {
				return false;
			}

			return generateSha1(moduleArchivePath)
				.then(fileHash => {
					if (fileHash === expectedHash) {
						return true;
					}

					return fs.remove(moduleArchivePath)
						.then(() => false);
				});
		});
};

ProjectManager.prototype.getDownloadPath = function (socketIoModule) {
	const targetFilename = path.basename(socketIoModule.url);
	return path.join(this.dataDirectoryPath, targetFilename);
};

ProjectManager.prototype.downloadModule = function (moduleInfo, dest) {
	return fs.ensureDir(path.dirname(dest))
		.then(() => axios.get(moduleInfo.url, { responseType: 'stream' }))
		.then(response => {
			return new Promise((resolve, reject) => {
				const destStream = fs.createWriteStream(dest);
				response.data.pipe(destStream);
				destStream.on('finish', () => {
					destStream.close(() => resolve(dest));
				});
				destStream.on('error', err => reject(err));
			});
		})
		.then(moduleArchivePath => {
			return generateSha1(moduleArchivePath)
				.then(fileHash => {
					if (fileHash !== moduleInfo.sha1) {
						throw new Error('SHA-1 hash of the downloaded socket.io module is invalid.');
					}

					return moduleArchivePath;
				});
		});
};

ProjectManager.prototype.installProjectHook = function () {
	this.logger.debug('Installing temporary project hook');
	const templatesPath = path.resolve(__dirname, '..', 'templates');

	const appJsTemplatePath = path.join(templatesPath, 'app.js');
	const appJsDestPath = path.join(this.options.tempPath, 'app.js');

	const hookTemplatePath = path.join(templatesPath, 'hooks.js');
	const hookDestPath = path.join(this.projectPath, 'hooks', 'karma.tmp.js');

	const karmaClientSrcPath = require.resolve('titanium-karma-client');
	const karmaClientDestPath = path.join(this.projectPath, 'Resources', 'titanium-karma-client.js');

	return fs.ensureDir(path.dirname(hookDestPath))
		.then(() => fs.readFile(appJsTemplatePath))
		.then(appJsContent => appJsContent.toString().replace('__CLIENT_CONFIG__', JSON.stringify(this.options.client)))
		.then(modifiedAppJsContent => fs.outputFile(appJsDestPath, modifiedAppJsContent))
		.then(() => fs.readFile(hookTemplatePath))
		.then(hookTemplate => {
			return hookTemplate.toString()
				.replace('__APP_JS__', appJsDestPath)
				.replace('__KARMA_CLIENT_SRC__', karmaClientSrcPath)
				.replace('__KARMA_CLIENT_DEST__', karmaClientDestPath);
		})
		.then(hookContent => fs.outputFile(hookDestPath, hookContent))
		.then(() => this.createdFiles.push(hookDestPath, karmaClientDestPath));
};

ProjectManager.prototype.detectAlloyPath = function () {
	if (process.env.ALLOY_PATH) {
		return;
	}

	let appcInstallBinaryPath = which.sync('appc', { nothrow: true });
	if (!appcInstallBinaryPath) {
		throw new AlloyDetectionError();
	}
	appcInstallBinaryPath = fs.realpathSync(appcInstallBinaryPath);
	const packageDir = path.resolve(appcInstallBinaryPath, '..', '..');
	const appcInstallUtilsPath = path.join(packageDir, 'lib', 'util.js');
	if (!fs.existsSync(appcInstallUtilsPath)) {
		throw new AlloyDetectionError();
	}
	const appcInstallUtils = require(appcInstallUtilsPath);
	const appcCliBinaryPath = appcInstallUtils.getInstallBinary();
	const appcCliModulesPath = path.resolve(appcCliBinaryPath, '..', '..', 'node_modules');
	const alloyPath = path.resolve(path.dirname(require.resolve('alloy', { paths: [ appcCliModulesPath ] })) + '/../bin/alloy');
	if (!fs.existsSync(alloyPath)) {
		throw new AlloyDetectionError();
	}

	process.env.ALLOY_PATH = alloyPath;
};

ProjectManager.prototype.undoChanges = function () {
	this.logger.debug('Undoing temporary changes made to project');
	for (const fileToDelete of this.createdFiles) {
		this.logger.debug(`  Deleting ${fileToDelete}`);
		fs.removeSync(fileToDelete);
	}
};

function generateSha1(pathAndFilename) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha1');
		const inputStream = fs.createReadStream(pathAndFilename);
		inputStream.on('data', function (data) {
			hash.update(data, 'utf8');
		});
		inputStream.on('end', function () {
			resolve(hash.digest('hex'));
		});
		inputStream.on('error', err => {
			reject(err);
		});
	});
}

class AlloyDetectionError extends Error {
	constructor() {
		let message = 'Unable to automatically detect your Alloy installation.';
		message += ' Please make sure that either Appcelerator CLI is installed or set the ALLOY_PATH environment variable.';
		super(message);
		this.name = 'AlloyDetectionError';
	}
}

module.exports = ProjectManager;
