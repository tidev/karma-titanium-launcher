/* global Ti */

import KarmaClient from 'titanium-karma-client';

import clientOptions from './config';
import StatusUpdater from './lib/status-updater';
import { Color } from './lib/util';

const statusView = Ti.UI.createView();
win.add(statusView);
const titleLabel = Ti.UI.createLabel({
	font: { fontSize: 32 },
	text: 'Unit Test Runner'
});
statusView.add(titleLabel);
const statusLabel = Ti.UI.createLabel({
	center: { y: '55%' },
	font: { fontSize: 22 },
	text: 'Waiting...',
	color: Color.Gray500
});
statusView.add(statusLabel);
win.add(statusView);

const connectionStatusView = Ti.UI.createView({
	bottom: 0,
	left: 0,
	right: 0,
	width: '100%',
	height: 50,
	backgroundColor: Color.Gray200
});
const connectionStatusLabel = Ti.UI.createLabel({
	left: 20,
	text: 'Connecting ...'
});
connectionStatusView.add(connectionStatusLabel);
win.add(connectionStatusView);

const executeButton = Ti.UI.createButton({
	title: 'Execute',
	bottom: 100
});
executeButton.addEventListener('click', () => {
	client.executeTestRun(client.config);
});
win.add(executeButton);

win.open();

const baseUrl = clientOptions.url;

global.wrappers = {};

const client = new KarmaClient(baseUrl);
client.connect();
const statusUpdater = new StatusUpdater(client, {
	statusLabel,
	connectionStatusView,
	connectionStatusLabel
});
