'use strict';

const axios = require('axios');
// eslint-disable-next-line security/detect-child-process
const { spawn } = require('child_process');
const crypto = require('crypto');
const extract = require('extract-zip');
const fs = require('fs-extra');
const path = require('path');
const TiAppXml = require('node-titanium-sdk').tiappxml;
const which = require('which');

const socketIoModules = {
	ios: {
		url: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/ios-1.1.2/ti.socketio-iphone-1.1.2.zip',
		sha1: 'c8e14c9921cf706a8b3d0dcec2e20c208ac712c3'
	},
	android: {
		url: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/android-1.0.2/ti.socketio-android-1.0.2.zip',
		sha1: '7b261a1b4b14b417c0066f7e5ef0e8988c0ef6bf'
	}
};

function ProjectManager(logger) {
	this.logger = logger.create('ti.project');
	this.tiBinaryPath = null;
	this.projectPath = null;
	this.projectPrepared = false;
	this.projectType = 'standalone';
	this.karmaRunnerProjectPath = null;
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
		.then(() => this.determineProjectType())
		.then(() => {
			switch (this.projectType) {
				case 'app':
					return this.prepareAppProject();
				case 'module':
					return this.prepareModuleProject();
				case 'standalone':
				default:
					return this.prepareStandaloneRunner();
			}
		})
		.then(() => this.downloadAndInstallSocketIoModule())
		.then(() => this.installProjectHook())
		.then(() => {
			if (this.projectType === 'app') {
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

ProjectManager.prototype.determineProjectType = function determineProjectType() {
	const cwd = process.cwd();
	let projectPathCandidate = cwd;
	const tiAppXmlPath = path.join(projectPathCandidate, 'tiapp.xml');
	if (fs.existsSync(tiAppXmlPath)) {
		this.projectType = 'app';
		this.projectPath = projectPathCandidate;
		return;
	}

	projectPathCandidate = path.join(cwd, this.options.platform);
	if (this.options.platform === 'ios' && !fs.existsSync(projectPathCandidate)) {
		projectPathCandidate = path.join(cwd, 'iphone');
	}
	const moduleXmlPath = path.join(projectPathCandidate, 'timodule.xml');
	if (fs.existsSync(moduleXmlPath)) {
		this.projectType = 'module';
		this.projectPath = projectPathCandidate;
		return;
	}

	this.projectPath = cwd;
	this.projectType = 'standalone';
};

ProjectManager.prototype.prepareAppProject = function () {
	this.logger.debug('Titanium app project detected, preparing ...');

	if (this.options.projectType === 'alloy') {
		this.detectAlloyPath();
	}

	this.karmaRunnerProjectPath = this.projectPath;

	return Promise.resolve();
};

ProjectManager.prototype.prepareModuleProject = function () {
	this.logger.debug('Titanium native module detected, preparing ...');

	let moduleArchivePath;
	const manifestPath = path.join(this.projectPath, 'manifest');
	if (!fs.existsSync(manifestPath)) {
		return Promise.reject(new Error(`Module manifest not found at expected path ${manifestPath}.`));
	}
	const manifest = {};
	fs.readFileSync(manifestPath).toString().split('\n').forEach(function (line) {
		const p = line.indexOf(':');
		if (line.charAt(0) !== '#' && p !== -1) {
			manifest[line.substring(0, p)] = line.substring(p + 1).trim();
		}
	});

	const args = [
		'build',
		'-d', this.projectPath,
		'-p', this.options.platform,
		'-b'
	];
	if (this.options.sdkVersion) {
		args.push('-s', this.options.sdkVersion);
	}
	this.logger.debug(`Building module ${manifest.moduleid} (${manifest.version}) for platform ${this.options.platform}`);
	return this.executeCommand('titanium', args)
		.then(() => {
			const moduleArchivePaths = [
				path.join(this.projectPath, 'dist', `${manifest.moduleid}-${manifest.platform}-${manifest.version}.zip`),
				path.join(this.projectPath, `${manifest.moduleid}-${manifest.platform}-${manifest.version}.zip`)
			];
			moduleArchivePath = moduleArchivePaths.find(archivePathCandidate => fs.existsSync(archivePathCandidate));
			if (!moduleArchivePath) {
				return Promise.reject(new Error(`Module archive not found at expected path. Searched the following paths:\n\t${moduleArchivePaths.join('\n\t')}`));
			}
		})
		.then(() => {
			const projectIdentifier = `${manifest.moduleid}.karmarunner`;
			return this.createKarmaRunnerProject(projectIdentifier, projectIdentifier);
		})
		.then(() => {
			return new Promise((resolve, reject) => {
				this.logger.debug(`Extracting module to ${this.karmaRunnerProjectPath}`);
				extract(moduleArchivePath, { dir: this.karmaRunnerProjectPath }, err => {
					if (err) {
						return reject(err);
					}

					resolve();
				});
			});
		})
		.then(() => {
			const tiAppXmlPath = path.join(`${this.karmaRunnerProjectPath}`, 'tiapp.xml');
			const tiAppXml = new TiAppXml(tiAppXmlPath);
			tiAppXml.modules.push({
				id: manifest.moduleid,
				platform: manifest.platform,
				version: manifest.version
			});
			tiAppXml.save(tiAppXmlPath);
		});
};

ProjectManager.prototype.prepareStandaloneRunner = function () {
	this.logger.debug('Standalone project detected, preparing ...');
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
			this.karmaRunnerProjectPath = path.join(this.options.tempPath, projectName);
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

ProjectManager.prototype.createKarmaRunnerProject = function createKarmaRunnerProject(projectName, projectIdentifier) {
	const args = [
		'create',
		'--id', projectIdentifier,
		'-n', projectName,
		'-t', 'app',
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
	this.logger.debug(`Creating Karma runner at ${path.join(this.options.tempPath, projectName)} (using ${this.options.sdkVersion ? 'SDK ' + this.options.sdkVersion : 'global default SDK'})`);
	return this.executeCommand('titanium', args)
		.then(() => {
			this.karmaRunnerProjectPath = path.join(this.options.tempPath, projectName);
		});
};

ProjectManager.prototype.downloadAndInstallSocketIoModule = function () {
	const tiAppXmlPath = path.join(`${this.karmaRunnerProjectPath}`, 'tiapp.xml');
	const tiAppXml = new TiAppXml(tiAppXmlPath);
	const validTargets = this.options.platform === 'ios' ? [ 'iphone', 'ipad' ] : [ this.options.platform ];
	const isSocketIoModuleEnabled = tiAppXml.modules && tiAppXml.modules.some(module => {
		return module.id === 'ti.socketio' && validTargets.indexOf(module.platform) !== -1;
	});
	if (isSocketIoModuleEnabled) {
		this.logger.debug('socket.io module already available, skipping integration');
		return;
	}

	this.logger.debug('socket.io is missing in project, temporarily integrating for this test run ...');
	const socketIoModule = socketIoModules[this.options.platform];
	const downloadDestPath = this.getDownloadPath(socketIoModule);
	return this.hasLocalCopy(socketIoModule)
		.then(hasLocalCopy => {
			if (hasLocalCopy) {
				return downloadDestPath;
			} else {
				return this.downloadModule(socketIoModule, downloadDestPath);
			}
		})
		.then(moduleArchivePath => {
			return new Promise((resolve, reject) => {
				extract(moduleArchivePath, {
					dir: this.karmaRunnerProjectPath
				}, err => {
					if (err) {
						reject(err);
					}

					this.createdFiles.push(path.join(this.karmaRunnerProjectPath, 'modules', 'ti.socketio'));

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
	const hookDestPath = path.join(this.karmaRunnerProjectPath, 'hooks', 'karma.tmp.js');

	const karmaClientSrcPath = require.resolve('titanium-karma-client');
	const karmaClientDestPath = path.join(this.karmaRunnerProjectPath, 'Resources', 'titanium-karma-client.js');

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
	if (this.projectType !== 'app') {
		return;
	}
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
