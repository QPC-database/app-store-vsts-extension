var path = require('path');
var taskLibrary = require('vsts-task-lib');
var ipaParser = require('ipa-metadata');

// Get input variables
var authType = taskLibrary.getInput('authType', false);
var credentials = {};
if (authType === "ServiceEndpoint") {
    var serviceEndpoint = taskLibrary.getEndpointAuthorization(taskLibrary.getInput("serviceEndpoint", true));
    credentials.username = serviceEndpoint.parameters.username;
    credentials.password = serviceEndpoint.parameters.password;
} else if (authType == "UserAndPass") {
    credentials.username = taskLibrary.getInput("username", true);
    credentials.password = taskLibrary.getInput("password", true);
}

var ipaPath = taskLibrary.getInput("ipaPath", true);
var languageString = taskLibrary.getInput("language", true);
var releaseNotes = taskLibrary.getInput("releaseNotes", false);
var shouldSubmitForReview = JSON.parse(taskLibrary.getInput("shouldSubmitForReview", false));
var shouldAutoRelease = JSON.parse(taskLibrary.getInput("shouldAutoRelease", false));
var teamId = taskLibrary.getInput("teamId", false);
var teamName = taskLibrary.getInput("teamName", false);

var bundleIdentifier;
var appVersion;
var appName;

// Set up environment
var gemCache = process.env['GEM_CACHE'] || process.platform == 'win32' ? path.join(process.env['APPDATA'], 'gem-cache') : path.join(process.env['HOME'], '.gem-cache');
process.env['GEM_HOME'] = gemCache;
process.env['FASTLANE_PASSWORD'] = credentials.password;
process.env['FASTLANE_DONT_STORE_PASSWORD'] = true;

// Add bin of new gem home so we don't ahve to resolve it later;
process.env['PATH'] = process.env['PATH'] + ":" + gemCache + path.sep + "bin";

ipaParser(ipaPath, function (err, extractedData) {
    if (err) {
        taskLibrary.setResult(1, "IPA Parsing failed: " + err.message);
    }

    var metadata = extractedData.metadata;

    if (!metadata) {
        taskLibrary.setResult(1, "IPA Metadata is empty.");
    }

    appName = metadata.CFBundleName;
    appVersion = metadata.CFBundleVersion;
    bundleIdentifier = metadata.CFBundleIdentifier;

    return installRubyGem("produce").then(function () {
        // Setting up arguments for produce command
        // See https://github.com/fastlane/produce for more information on these arguments
        var args = [];
        args.push("-u");
        args.push(credentials.username);
        args.push("-a");
        args.push(bundleIdentifier);
        args.push("-q");
        args.push(appName);
        args.push("-m");
        args.push(languageString);

        if (shouldSubmitForReview) {
            args.push("--submit_for_review");
        }

        if (shouldAutoRelease) {
            args.push("--automatic_release");
        }

        if (releaseNotes) {
            args.push("--release_notes");
            args.push(releaseNotes);
        }

        if (teamId) {
            args.push("-b");
            args.push(teamId);
        }

        if (teamName) {
            args.push("-l");
            args.push(teamName);
        }

        return runCommand("produce", args).fail(function (err) {
            taskLibrary.setResult(1, err.message);
        });
    }).then(function () {
        return installRubyGem("deliver").then(function () {
            // Setting up arguments for initializing deliver command
            // See https://github.com/fastlane/deliver for more information on these arguments
            var args = ["init"];
            args.push("-u");
            args.push(credentials.username);
            args.push("-a");
            args.push(bundleIdentifier);
            args.push("-i");
            args.push(ipaPath);

            return runCommand("deliver", args).then(function () {
                return runCommand("deliver", ["--force", "-i", ipaPath]).fail(function (err) {
                    taskLibrary.setResult(1, err.message);
                });
            });
        });
    }).fail(function (err) {
        taskLibrary.setResult(1, err.message);
    });
});

function installRubyGem(packageName, localPath) {
    taskLibrary.debug("Checking for ruby install...");
    taskLibrary.which("ruby", true);
    taskLibrary.debug("Checking for gem install...");
    taskLibrary.which("gem", true);

    taskLibrary.debug("Setting up gem install");
    var command = new taskLibrary.ToolRunner("gem");
    command.arg("install");
    command.arg(packageName);

    if (localPath) {
        command.arg("--install-dir");
        command.arg(localPath);
    }

    taskLibrary.debug("Attempting to install " + packageName + " to " + (localPath ? localPath : " default cache directory (" + process.env['GEM_HOME'] + ")"));
    return command.exec().fail(function (err) {
        console.error(err.message);
        taskLibrary.debug('taskRunner fail');
    });
}

function runCommand(commandString, args) {
    taskLibrary.debug("Setting up command " + commandString);
    if (typeof args == "string") {
        args = [args];
    }

    var command = new taskLibrary.ToolRunner(commandString);

    if (args) {
        args.forEach(function (arg) {
            taskLibrary.debug("Appending argument: " + arg);
            command.arg(arg);
        });
    }

    return command.exec().fail(function (err) {
        console.error(err.message);
        taskLibrary.debug('taskRunner fail');
    });
}
