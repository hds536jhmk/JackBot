const SQLite = require("./databases/SQLite.js");
const MariaDB = require("./databases/MariaDB.js");
const DBDefinitions = require("./DatabaseDefinitions.js");
const { Sequelize, Model, ModelCtor, SyncOptions } = require("sequelize");

/** @typedef {(boolean|((sql: string, timing?: number) => void))?} SequelizeLogging */

/**
 * Generic Settings for Databases
 * @typedef {Object} DatabaseSettings
 * @property {"sqlite"|"mariadb"} mode The Database mode
 * @property {SequelizeLogging} [logging] A Logger for Sequelize
 * @property {SQLite.SQLiteSettings} [sqlite] Specific Database Settings for "sqlite" mode
 * @property {MariaDB.MariaDBSettings} [mariadb] Specific Database Settings for "mariadb" mode
 */

/** @type {Sequelize} */
let _DBInstance = null;

/** @type {ModelCtor<Model>} */
let _Guild = null;

/**
 * Returns whether or not the Database was started
 * @returns {Boolean} Whether or not the Database was started
 */
const IsStarted = () => _DBInstance !== null;

const _EnsureStart = () => {
    if (!IsStarted()) throw Error("Database wasn't yet Started.");
};

/**
 * Starts the Database with the specified settings
 * @param {DatabaseSettings} settings The settings to start the Database with
 */
const Start = async (settings) => {
    if (IsStarted()) throw new Error("Can't Start Database, it's Already Running.");

    switch (settings.mode) {
    case "sqlite":
        _DBInstance = SQLite(settings.sqlite, settings.logging);
        break;
    case "mariadb":
        _DBInstance = MariaDB(settings.mariadb, settings.logging);
        break;
    default:
        throw new Error("Database Mode not Valid.");
    }

    /** @type {SyncOptions} */
    const syncOptions = { "alter": true };

    // Defining and Syncing Models
    _Guild = _DBInstance.define("Guild", DBDefinitions.GuildModel);
    await _Guild.sync(syncOptions);
    
    // Trying to authenticate to the Database
    await _DBInstance.authenticate();
};

/**
 * @param {String} guildID
 * @returns {Model}
 */
const _FindOrCreateGuild = async (guildID) => {
    const [ instance ] = await _Guild.findOrCreate({
        "where":    { guildID },
        "defaults": { guildID }
    });
    return instance;
};

/**
 * Creates an entry for guildID if it doesn't exist and returns it
 * @param {String} guildID The ID of the Guild to Get or Create
 * @returns {DBDefinitions.GuildRow} The Row of the Guild
 */
const GetGuild = async (guildID) => {
    _EnsureStart();
    const instance = await _FindOrCreateGuild(guildID);
    return instance.get();
};

/**
 * Sets the specified Guild Attributes
 * @param {String} guildID The Guild to set the attributes for
 * @param {DBDefinitions.GuildRow} attributes The Attributes to set ( undefined keys don't change attributes )
 * @returns {DBDefinitions.GuildRow} The updated Guild Row
 */
const SetGuildAttr = async (guildID, attributes) => {
    _EnsureStart();
    const instance = await _FindOrCreateGuild(guildID);
    for (const key of Object.keys(attributes)) {
        instance.set(key, attributes[key]);
    }
    await instance.save();
    return instance.get();
};

/**
 * Removes the specified Guild from the Database
 * @param {String} guildID The ID of the Guild to Remove
 */
const RemoveGuild = async (guildID) => {
    _EnsureStart();
    await _Guild.destroy({ "where": { guildID } });
};

module.exports = { IsStarted, Start, GetGuild, SetGuildAttr, RemoveGuild };
