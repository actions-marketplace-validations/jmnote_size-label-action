#!/usr/bin/env node

const fs = require("fs");
const process = require("process");

const { Octokit } = require("@octokit/action");
const globrex = require("globrex");
const Diff = require("diff");

const defaultSizes = {
  0: "XS",
  10: "S",
  30: "M",
  100: "L",
  500: "XL",
  1000: "XXL"
};

const actions = ["opened", "synchronize", "reopened"];

const globrexOptions = { extended: true, globstar: true };

async function main() {
  debug("Running size-label-action...");

  const octokit = new Octokit();
  const eventPayload = require(process.env.GITHUB_EVENT_PATH);
  const repositoryId = eventPayload.repository.node_id;

  debug("eventPayload:", eventPayload);

  if (!eventPayload || !eventPayload.pull_request || !eventPayload.pull_request.base) {
    throw new Error(`Invalid eventPayload: ${eventPayload}`);
  }

  if (!actions.includes(eventPayload.action)) {
    console.log("Action will be ignored:", eventPayload.action);
    return false;
  }

  const isIgnored = parseIgnored(process.env.IGNORED);

  const pull_number = eventData.pull_request.number;

  const octokit = new Octokit();
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  const pullRequestDiff = await octokit.pulls.get({
    owner: owner,
    repo: repo,
    pull_number,
    headers: {
      accept: "application/vnd.github.v3.diff"
    }
  });

  const changedLines = getChangedLines(isIgnored, pullRequestDiff.data);
  console.log("Changed lines:", changedLines);

  const sizes = getSizesInput();
  const sizeLabel = getSizeLabel(changedLines, sizes);
  console.log("Matching label:", sizeLabel);

  const { add, remove } = getLabelChanges(
    sizeLabel,
    eventData.pull_request.labels
  );

  if (add.length === 0 && remove.length === 0) {
    console.log("Correct label already assigned");
    return false;
  }

  if (add.length > 0) {
    debug("Adding labels:", add);
    await octokit.issues.addLabels({
      owner: owner,
      repo: repo,
      issue_number: pull_number,
      labels: add
    });
  }

  for (const label of remove) {
    debug("Removing label:", label);
    try {
      await octokit.issues.removeLabel({
        owner: owner,
        repo: repo,
        issue_number: pull_number,
        name: label
      });
    } catch (error) {
      debug("Ignoring removing label error:", error);
    }
  }

  debug("Success!");

  return true;
}

function debug(...str) {
  if (process.env.DEBUG_ACTION) {
    console.log.apply(console, str);
  }
}

function parseIgnored(str = "") {
  const ignored = str
    .split(/\r|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("#"))
    .map(s =>
      s.length > 1 && s[0] === "!"
        ? { not: globrex(s.substr(1), globrexOptions) }
        : globrex(s, globrexOptions)
    );
  function isIgnored(path) {
    if (path == null || path === "/dev/null") {
      return true;
    }
    const pathname = path.substr(2);
    let ignore = false;
    for (const entry of ignored) {
      if (entry.not) {
        if (pathname.match(entry.not.regex)) {
          return false;
        }
      } else if (!ignore && pathname.match(entry.regex)) {
        ignore = true;
      }
    }
    return ignore;
  }
  return isIgnored;
}

async function readFile(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, { encoding: "utf8" }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function getChangedLines(isIgnored, diff) {
  return Diff.parsePatch(diff)
    .flatMap(file =>
      isIgnored(file.oldFileName) && isIgnored(file.newFileName)
        ? []
        : file.hunks
    )
    .flatMap(hunk => hunk.lines)
    .filter(line => line[0] === "+" || line[0] === "-").length;
}

function getSizeLabel(changedLines, sizes = defaultSizes) {
  let label = null;
  for (const lines of Object.keys(sizes).sort((a, b) => a - b)) {
    if (changedLines >= lines) {
      label = `size/${sizes[lines]}`;
    }
  }
  return label;
}

function getLabelChanges(newLabel, existingLabels) {
  const add = [newLabel];
  const remove = [];
  for (const existingLabel of existingLabels) {
    const { name } = existingLabel;
    if (name.startsWith("size/")) {
      if (name === newLabel) {
        add.pop();
      } else {
        remove.push(name);
      }
    }
  }
  return { add, remove };
}

function getSizesInput() {
  let inputSizes = process.env.INPUT_SIZES;
  if (inputSizes && inputSizes.length) {
    return JSON.parse(inputSizes);
  } else {
    return undefined;
  }
}

if (require.main === module) {
  main().then(
    () => (process.exitCode = 0),
    e => {
      process.exitCode = 1;
      console.error(e);
    }
  );
}

module.exports = { main };
