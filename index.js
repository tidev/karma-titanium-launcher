const ProjectManager = require('./lib/project-manager');
const TitaniumLauncher = require('./lib/titanium-launcher');

module.exports = {
	projectManager: [ 'type', ProjectManager ],
	'launcher:Titanium': [ 'type', TitaniumLauncher ]
};
