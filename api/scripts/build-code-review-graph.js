/**
 * Build Code Review Graph for this monorepo.
 *
 * Problem:
 * code-review-graph may scan node_modules, dist and .next folders,
 * causing more than 100,000 files to be parsed.
 *
 * This script:
 * 1. Moves generated folders outside the repository.
 * 2. Deletes the old graph.
 * 3. Builds a new graph.
 * 4. Restores all moved folders.
 *
 * Usage:
 *   node scripts/build-code-review-graph.js
 *   node scripts/build-code-review-graph.js --restore
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const projectName = path.basename(projectRoot);

// Keep temporary files outside the repository.
// Example:
// D:\Projects\douyin-clone
// D:\Projects\_crg_temp_douyin-clone
const tempRoot = path.join(
  path.dirname(projectRoot),
  `_crg_temp_${projectName}`
);

const manifestPath = path.join(tempRoot, 'manifest.json');

const graphDirectory = path.join(
  projectRoot,
  '.code-review-graph'
);

/**
 * Only list top-level generated directories here.
 * Do not recursively search for node_modules because node_modules
 * itself may contain hundreds of nested node_modules directories.
 */
const directoriesToMove = [
  'admin/node_modules',
  'admin/dist',
  'admin/.next',

  'user/node_modules',
  'user/dist',
  'user/.next',

  'api/node_modules',
  'api/dist',

  'file-server/node_modules',
  'file-server/dist'
];

function normalizeName(relativePath) {
  return relativePath
    .replace(/[\\/]/g, '__')
    .replace(/^\.+/, '');
}

function ensureTempDirectory() {
  fs.mkdirSync(tempRoot, {
    recursive: true
  });
}

function saveManifest(records) {
  ensureTempDirectory();

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(records, null, 2),
    'utf8'
  );
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    return JSON.parse(
      fs.readFileSync(manifestPath, 'utf8')
    );
  } catch (error) {
    throw new Error(
      `Cannot read restore manifest: ${error.message}`
    );
  }
}

function removeDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  try {
    fs.rmSync(directoryPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500
    });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EBUSY') {
      throw new Error(
        [
          `Cannot remove locked directory: ${directoryPath}`,
          '',
          'The Code Review Graph database is probably being used by:',
          '- Codex / Antigravity MCP',
          '- code-review-graph serve',
          '- code-review-graph watch',
          '- crg-daemon',
          '',
          'Close Codex/Antigravity or stop the CRG process, then run again.',
          '',
          `Original error: ${error.message}`
        ].join('\n')
      );
    }

    throw error;
  }
}

function moveGeneratedDirectories() {
  ensureTempDirectory();

  const existingManifest = loadManifest();

  if (existingManifest.length > 0) {
    throw new Error(
      [
        'A previous temporary CRG build was not restored.',
        `Temporary directory: ${tempRoot}`,
        '',
        'Run this command first:',
        'node scripts/build-code-review-graph.js --restore'
      ].join('\n')
    );
  }

  const movedDirectories = [];

  for (const relativePath of directoriesToMove) {
    const sourcePath = path.join(projectRoot, relativePath);

    if (!fs.existsSync(sourcePath)) {
      console.log(`[skip] ${relativePath} does not exist`);
      continue;
    }

    const temporaryName = normalizeName(relativePath);
    const destinationPath = path.join(
      tempRoot,
      temporaryName
    );

    if (fs.existsSync(destinationPath)) {
      throw new Error(
        `Temporary destination already exists: ${destinationPath}`
      );
    }

    console.log(`[move] ${relativePath}`);

    fs.renameSync(sourcePath, destinationPath);

    movedDirectories.push({
      relativePath,
      sourcePath,
      destinationPath
    });

    // Save after every successful move.
    // This allows --restore to recover if the process is interrupted.
    saveManifest(movedDirectories);
  }

  return movedDirectories;
}

function restoreGeneratedDirectories() {
  const records = loadManifest();

  if (records.length === 0) {
    console.log('[restore] Nothing to restore.');

    if (fs.existsSync(tempRoot)) {
      removeDirectory(tempRoot);
    }

    return;
  }

  const failedRecords = [];

  // Restore in reverse order.
  for (const record of [...records].reverse()) {
    const {
      relativePath,
      sourcePath,
      destinationPath
    } = record;

    if (!fs.existsSync(destinationPath)) {
      console.log(
        `[skip restore] Temporary folder is missing: ${destinationPath}`
      );
      continue;
    }

    if (fs.existsSync(sourcePath)) {
      console.error(
        `[restore failed] Destination already exists: ${relativePath}`
      );

      failedRecords.push(record);
      continue;
    }

    fs.mkdirSync(path.dirname(sourcePath), {
      recursive: true
    });

    console.log(`[restore] ${relativePath}`);

    try {
      fs.renameSync(destinationPath, sourcePath);
    } catch (error) {
      console.error(
        `[restore failed] ${relativePath}: ${error.message}`
      );

      failedRecords.push(record);
    }
  }

  if (failedRecords.length > 0) {
    saveManifest(failedRecords);

    throw new Error(
      [
        'Some folders could not be restored.',
        `Check: ${tempRoot}`,
        '',
        'After fixing the destination folders, run:',
        'node scripts/build-code-review-graph.js --restore'
      ].join('\n')
    );
  }

  removeDirectory(tempRoot);

  console.log('[restore] All generated folders restored.');
}

function buildGraph() {
  const cleanGraph = process.env.CRG_CLEAN === 'true';

  if (cleanGraph) {
    console.log('[clean] Removing old Code Review Graph...');

    removeDirectory(graphDirectory);
  } else {
    console.log('[clean] Skipped existing graph cleanup.');
  }

  const command = process.platform === 'win32'
    ? 'py'
    : 'python3';

  const args = [
    '-m',
    'code_review_graph',
    'build'
  ];

  console.log(`[build] Working directory: ${projectRoot}`);
  console.log(`[build] ${command} ${args.join(' ')}`);

  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Code Review Graph build failed with exit code ${result.status}`
    );
  }
}

function verifyGraph() {
  if (!fs.existsSync(graphDirectory)) {
    throw new Error(
      `Graph directory was not created: ${graphDirectory}`
    );
  }

  console.log(`[success] Graph created at: ${graphDirectory}`);
}

function validateProjectRoot() {
  const requiredDirectories = [
    'admin',
    'user',
    'api',
    'file-server'
  ];

  const missingDirectories = requiredDirectories.filter(
    (directory) => !fs.existsSync(path.join(projectRoot, directory))
  );

  if (missingDirectories.length > 0) {
    throw new Error(
      [
        `Invalid project root: ${projectRoot}`,
        `Missing directories: ${missingDirectories.join(', ')}`,
        '',
        'Expected monorepo root containing:',
        'admin, user, api and file-server'
      ].join('\n')
    );
  }
}

async function main() {
  validateProjectRoot();

  const restoreOnly = process.argv.includes('--restore');

  if (restoreOnly) {
    restoreGeneratedDirectories();
    return;
  }

  console.log(`Project: ${projectRoot}`);
  console.log(`Temporary directory: ${tempRoot}`);
  console.log('');

  let buildError;

  try {
    moveGeneratedDirectories();
    buildGraph();
    verifyGraph();
  } catch (error) {
    buildError = error;

    console.error('');
    console.error(`[error] ${error.message}`);
  } finally {
    if (fs.existsSync(manifestPath)) {
      try {
        restoreGeneratedDirectories();
      } catch (restoreError) {
        console.error('');
        console.error(`[restore error] ${restoreError.message}`);

        throw restoreError;
      }
    }
  }

  if (buildError) {
    throw buildError;
  }

  console.log('');
  console.log('Code Review Graph build completed successfully.');
}

/**
 * Entry point required by api/script.js.
 */
const run = async () => {
  await main();
};

module.exports = run;
module.exports.run = run;