'use strict';

const EventEmitter = require('events');
const axios = require('axios');
// eslint-disable-next-line security/detect-child-process
const { spawn } = require('child_process');
const crypto = require('crypto');
const util = require('util');
const extract = util.promisify(require('extract-zip'));
const fs = require('fs-extra');
const path = require('path');
const TiAppXml = require('node-titanium-sdk').tiappxml;
const which = require('which');

const socketIoModules = {
	ios: {
		url: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/ios-v2.0.0/ti.socketio-iphone-2.0.0.zip',
		sha1: 'a17a22eeb414797f581a7772a8812e29a4392a4c'
	},
	android: {
		url: 'https://github.com/appcelerator-modules/titanium-socketio/releases/download/android-v2.0.0/ti.socketio-android-2.0.0.zip',
		sha1: '38f5feaef6c7636a797eebea2f567d67777c0cb6'
	}
};

// TODO: Move to class syntax? seems to break karma if we do for now...
/**
 * @class ProjectManager
 * @property {string} tiBinaryPath path to titanium binary
 * @property {string} projectPath path to project we're running/building
 * @property {boolean} projectPrepared is the project prepared to run?
 * @property {string} projectType 'standalone', 'app', 'module'
 * @property {string} karmaRunnerProjectPath path to karma runner project
 * @property {string[]} createdFiles temporary files to clean up when done
 * @property {string} dataDirectoryPath path to data directory
 * @constructor
 * @param {object} logger logger to use
 */
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

util.inherits(ProjectManager, EventEmitter);

/**
 * @param {object} options options used in setup
 * @param {string} [options.sdkVersion] sdk version to install/use
 * @param {string} options.platform 'ios' || 'android'
 * @param {string} [options.projectType] 'alloy'
 * @param {string} options.tempPath directory to generate project
 * @param {object} options.client karma client config
 * @returns {Promise<void>}
 */
ProjectManager.prototype.prepareProject = async function (options) {
	this.options = options;

	if (this.projectPrepared) {
		return;
	}

	await this.ensureSdkIsInstalled();
	await this.determineProjectType();

	switch (this.projectType) {
		case 'app':
			await this.prepareAppProject();
			break;
		case 'module':
			await this.prepareModuleProject();
			break;
		case 'standalone':
		default:
			await this.prepareStandaloneRunner();
			break;
	}

	await this.downloadAndInstallSocketIoModule();
	await this.installProjectHook();
	if (this.projectType === 'app') {
		this.projectPrepared = true;
	}
	this.emit('prepared');
};

/**
 * @returns {Promise<void>}
 */
ProjectManager.prototype.ensureSdkIsInstalled = async function ensureSdkIsInstalled() {
	if (!this.options.sdkVersion) {
		return;
	}

	const result = await this.executeCommand('titanium', [ 'sdk', 'list', '-o', 'json' ]);
	let sdkList;
	try {
		sdkList = JSON.parse(result);
	} catch (e) {
		throw new Error(`Failed to parse SDK list: ${e}`);
	}
	if (sdkList.installed[this.options.sdkVersion]) {
		this.activeSDK = sdkList.activeSDK; // record the active SDK!
		this.logger.debug(`Configured SDK version ${this.options.sdkVersion} is installed.`);
		return;
	}

	this.logger.debug(`Configured SDK version ${this.options.sdkVersion} is not installed, starting download ...`);
	return this.executeCommand('titanium', [ 'sdk', 'install', this.options.sdkVersion ]);
};

/**
 * @returns {Promise<void>}
 */
ProjectManager.prototype.determineProjectType = async function determineProjectType() {
	const cwd = process.cwd();
	let projectPathCandidate = cwd;
	const tiAppXmlPath = path.join(projectPathCandidate, 'tiapp.xml');
	if (await fs.exists(tiAppXmlPath)) {
		this.projectType = 'app';
		this.projectPath = projectPathCandidate;
		return;
	}

	projectPathCandidate = path.join(cwd, this.options.platform);
	if (this.options.platform === 'ios' && !await fs.exists(projectPathCandidate)) {
		projectPathCandidate = path.join(cwd, 'iphone');
	}
	const moduleXmlPath = path.join(projectPathCandidate, 'timodule.xml');
	if (await fs.exists(moduleXmlPath)) {
		this.projectType = 'module';
		this.projectPath = projectPathCandidate;
		return;
	}

	this.projectPath = cwd;
	this.projectType = 'standalone';
};

/**
 * @returns {Promise<void>}
 */
ProjectManager.prototype.prepareAppProject = async function () {
	this.logger.debug('Titanium app project detected, preparing ...');

	if (this.options.projectType === 'alloy') {
		await this.detectAlloyPath();
	}

	this.karmaRunnerProjectPath = this.projectPath;
};

/**
 * @param {string} manifestPath path to manifest file in module project
 * @returns {object} manifest file turned into a JS object with key/value properties
 */
async function readManifest(manifestPath) {
	if (!await fs.exists(manifestPath)) {
		throw new Error(`Module manifest not found at expected path ${manifestPath}.`);
	}
	const manifest = {};
	const contents = await fs.readFile(manifestPath, 'utf8');
	contents.split('\n').forEach(line => {
		const p = line.indexOf(':');
		if (line.charAt(0) !== '#' && p !== -1) {
			manifest[line.substring(0, p)] = line.substring(p + 1).trim();
		}
	});
	return manifest;
}

/**
 * @param {string} xcconfigPath path to the titanium.xcconfig file in the module project
 * @returns {Promise<void>}
 */
ProjectManager.prototype.modifyTitaniumXcconfig = async function (xcconfigPath) {
	await fs.move(xcconfigPath, `${xcconfigPath}.bak`, { overwrite: true }); // create backup of original
	const contents = await fs.readFile(`${xcconfigPath}.bak`, 'utf8');
	// if user hasn't set an SDK version to use, use the active SDK version
	const sdkVersion = this.options.sdkVersion || this.activeSDK;
	return fs.writeFile(xcconfigPath, contents.replace(/TITANIUM_SDK_VERSION = [^\s]+/, `TITANIUM_SDK_VERSION = ${sdkVersion}`));
};

ProjectManager.prototype.prepareModuleProject = async function () {
	this.logger.debug('Titanium native module detected, preparing ...');

	const manifestPath = path.join(this.projectPath, 'manifest');
	const manifest = await readManifest(manifestPath);

	if (this.options.platform === 'ios') {
		await this.modifyTitaniumXcconfig(path.join(this.projectPath, 'titanium.xcconfig'));
	}

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
	await this.executeCommand('titanium', args);

	const moduleArchivePaths = [
		path.join(this.projectPath, 'dist', `${manifest.moduleid}-${manifest.platform}-${manifest.version}.zip`),
		path.join(this.projectPath, `${manifest.moduleid}-${manifest.platform}-${manifest.version}.zip`)
	];
	const moduleArchivePath = moduleArchivePaths.find(archivePathCandidate => fs.existsSync(archivePathCandidate));
	if (!moduleArchivePath) {
		throw new Error(`Module archive not found at expected path. Searched the following paths:\n\t${moduleArchivePaths.join('\n\t')}`);
	}

	const projectIdentifier = `${manifest.moduleid}.karmarunner`;
	await this.createKarmaRunnerProject(projectIdentifier, projectIdentifier);

	this.logger.debug(`Extracting module to ${this.karmaRunnerProjectPath}`);
	await extract(moduleArchivePath, { dir: this.karmaRunnerProjectPath });

	const tiAppXmlPath = path.join(`${this.karmaRunnerProjectPath}`, 'tiapp.xml');
	const tiAppXml = new TiAppXml(tiAppXmlPath);
	tiAppXml.modules.push({
		id: manifest.moduleid,
		platform: manifest.platform,
		version: manifest.version
	});
	tiAppXml.save(tiAppXmlPath);
};

ProjectManager.prototype.prepareStandaloneRunner = async function () {
	this.logger.debug('Standalone project detected, preparing ...');
	// TODO: Call this.createKarmaRunnerProject()? Only difference is additional -u localhost args
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
	await this.executeCommand('titanium', args);
	this.karmaRunnerProjectPath = path.join(this.options.tempPath, projectName);
};

/**
 * @param {string} command command to run
 * @param {string[]} args command line arguments
 * @param {object} [options] options to `spawn`
 * @returns {Promise<string>} stdout of process
 */
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

/**
 * @param {string} projectName name of the project to generate
 * @param {string} projectIdentifier id for generated project
 * @returns {Promise<void>}
 */
ProjectManager.prototype.createKarmaRunnerProject = async function createKarmaRunnerProject(projectName, projectIdentifier) {
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
	await this.executeCommand('titanium', args);
	this.karmaRunnerProjectPath = path.join(this.options.tempPath, projectName);
};

/**
 * @returns {Promise<void>}
 */
ProjectManager.prototype.downloadAndInstallSocketIoModule = async function () {
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
	const hasLocalCopy = await this.hasLocalCopy(socketIoModule);
	const moduleArchivePath = hasLocalCopy ? downloadDestPath : await this.downloadModule(socketIoModule, downloadDestPath);

	await extract(moduleArchivePath, { dir: this.karmaRunnerProjectPath });
	this.createdFiles.push(path.join(this.karmaRunnerProjectPath, 'modules', 'ti.socketio'));
};

/**
 * @param {object} socketIoModule module metadata
 * @param {string} socketIoModule.sha1 SHA1 hash for the module
 * @returns {Promise<boolean>}
 */
ProjectManager.prototype.hasLocalCopy = async function (socketIoModule) {
	const expectedHash = socketIoModule.sha1;
	const moduleArchivePath = this.getDownloadPath(socketIoModule);

	const moduleArchiveExists = await fs.pathExists(moduleArchivePath);
	if (!moduleArchiveExists) {
		return false;
	}

	const fileHash = await generateSha1(moduleArchivePath);
	if (fileHash === expectedHash) {
		return true;
	}

	await fs.remove(moduleArchivePath);
	return false;
};

/**
 * @param {object} socketIoModule module metadata
 * @param {string} socketIoModule.url url for module
 * @returns {string}
 */
ProjectManager.prototype.getDownloadPath = function (socketIoModule) {
	const targetFilename = path.basename(socketIoModule.url);
	return path.join(this.dataDirectoryPath, targetFilename);
};

/**
 * @param {object} moduleInfo object containing details of module
 * @param {string} moduleInfo.url URL to download module
 * @param {string} moduleInfo.sha1 SHA1 for module
 * @param {string} dest destination path to download to
 * @returns {Promise<string>} path to downloaded module
 */
ProjectManager.prototype.downloadModule = async function (moduleInfo, dest) {
	await fs.ensureDir(path.dirname(dest));
	const response = await axios.get(moduleInfo.url, { responseType: 'stream' });
	const moduleArchivePath = await pipe(response.data, dest);

	const fileHash = await generateSha1(moduleArchivePath);
	if (fileHash !== moduleInfo.sha1) {
		throw new Error('SHA-1 hash of the downloaded socket.io module is invalid.');
	}

	return moduleArchivePath;
};

/**
 * @param {object} inStream stream we're reading
 * @param {string} dest destination file we're piping to
 * @returns {Promise<string>}
 */
function pipe(inStream, dest) {
	return new Promise((resolve, reject) => {
		const destStream = fs.createWriteStream(dest);
		inStream.pipe(destStream);
		destStream.on('finish', () => {
			destStream.close(() => resolve(dest));
		});
		destStream.on('error', err => reject(err));
	});
}

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

/**
 * @returns {Promise<void>}
 */
ProjectManager.prototype.detectAlloyPath = async function () {
	if (process.env.ALLOY_PATH) {
		return;
	}

	let appcInstallBinaryPath = which.sync('appc', { nothrow: true });
	if (!appcInstallBinaryPath) {
		throw new AlloyDetectionError();
	}
	appcInstallBinaryPath = await fs.realpath(appcInstallBinaryPath);
	const packageDir = path.resolve(appcInstallBinaryPath, '..', '..');
	const appcInstallUtilsPath = path.join(packageDir, 'lib', 'util.js');
	if (!await fs.exists(appcInstallUtilsPath)) {
		throw new AlloyDetectionError();
	}
	// eslint-disable-next-line security/detect-non-literal-require
	const appcInstallUtils = require(appcInstallUtilsPath);
	const appcCliBinaryPath = appcInstallUtils.getInstallBinary();
	const appcCliModulesPath = path.resolve(appcCliBinaryPath, '..', '..', 'node_modules');
	const alloyPath = path.resolve(path.dirname(require.resolve('alloy', { paths: [ appcCliModulesPath ] })) + '/../bin/alloy');
	if (!await fs.exists(alloyPath)) {
		throw new AlloyDetectionError();
	}

	process.env.ALLOY_PATH = alloyPath;
};

/**
 * synchronously undo changes on 'done' event callback from titanium-launcher
 */
ProjectManager.prototype.undoChanges = function () {
	// For module projects, revert titanium.xcconfig changes
	if (this.projectType === 'module' && this.options.platform === 'ios') {
		this.logger.debug('Undoing temporary changes made to project');
		const xcconfigPath = path.join(this.projectPath, 'titanium.xcconfig');
		fs.removeSync(xcconfigPath);
		fs.moveSync(`${xcconfigPath}.bak`, xcconfigPath);
	} else if (this.projectType === 'app') {
		this.logger.debug('Undoing temporary changes made to project');
		for (const fileToDelete of this.createdFiles) {
			this.logger.debug(`  Deleting ${fileToDelete}`);
			fs.removeSync(fileToDelete);
		}
	}
};

/**
 * @param {string} pathAndFilename full path to file
 * @returns {Promise<string>} generated sha1 hash
 */
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
