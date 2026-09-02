/**
 * Environment loading for the demo scripts.
 *
 * The keys come from `api/.env` and from nowhere else — never a command-line
 * flag (which lands in the shell history and in `ps` output for every user on
 * the machine) and never a config file (which lands in git). Every secret read
 * here is registered with the logger before it is returned, so that anything
 * printed later has it stripped whether or not the caller remembered.
 */

const path = require('path');

const logger = require('./logger');

/** Load `api/.env` into `process.env` without overwriting a real environment. */
function loadEnv() {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
}

/**
 * Read a required secret, register it as unprintable, and return it.
 *
 * The error names the variable and never quotes a value — not even a partial
 * one. A prefix is still a prefix.
 */
function requireSecret(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `${name} is not set. Add it to api/.env — see api/.env.example. `
      + 'Never pass a key on the command line.'
    );
  }
  logger.registerSecret(value.trim());
  return value.trim();
}

/** Same, but an absent value is allowed and reported as null. */
function optionalSecret(name) {
  const value = process.env[name];
  if (!value || !value.trim()) return null;
  logger.registerSecret(value.trim());
  return value.trim();
}

function requireValue(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is not set. Add it to api/.env — see api/.env.example.`);
  }
  return value.trim();
}

/**
 * The credentials phase 1 needs.
 *
 * Pexels is required because it is the primary source. Pixabay is optional: it
 * is only consulted when Pexels cannot fill a slot, and a dataset built without
 * it is smaller rather than broken.
 */
function loadFetchCredentials() {
  loadEnv();
  const pexelsKey = requireSecret('PEXELS_API_KEY');
  const pixabayKey = optionalSecret('PIXABAY_API_KEY');
  return { pexelsKey, pixabayKey };
}

/**
 * The connection details phase 2 needs.
 *
 * No provider key is read here at all. `demo:seed` must run with the network
 * unplugged, so reading one would be a lie about what the script depends on.
 */
function loadSeedConnections() {
  loadEnv();
  return {
    mongoUri: requireValue('MONGO_URI'),
    fileServerBaseUrl: requireValue('FILE_SERVER_BASE_URL').replace(/\/+$/, ''),
    fileServerApiKey: requireSecret('FILE_SERVER_API_KEY'),
    internalApiKey: requireSecret('INTERNAL_API_KEY')
  };
}

module.exports = {
  loadEnv,
  requireSecret,
  optionalSecret,
  requireValue,
  loadFetchCredentials,
  loadSeedConnections
};
