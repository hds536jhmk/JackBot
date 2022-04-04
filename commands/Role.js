const { GuildMember } = require("discord.js");
const Sequelize = require("sequelize");
const { CreateCommand, Permissions, Database, Utils, DatabaseDefinitions } = require("../Command.js");
const { ReplyIfBlacklisted } = require("./utils/AccessListUtils.js");

const _EMPTY_STRING_LIST = ";;";

/**
 * @param {String} str
 * @returns {String[]}
 */
const _StringListToArray = (str) => {
    if (str.length <= 2) return [ ]; // ";;" -> [ ]
    // ";Hello;World;" -> [ "", "Hello", "World", "" ] -> [ "Hello", "World" ]
    return str.split(";").slice(1, -1);
};

/**
 * @param {String[]} arr
 * @returns {String}
 */
const _ArrayToStringList = (arr) => {
    // [ "Hello", "World" ] -> ";Hello;World;"
    return arr.length === 0 ? _EMPTY_STRING_LIST : Utils.JoinArray([ "", ...arr, ""], ";");
};

/**
 * @param {String[]} roles
 * @param {GuildMember} member
 * @returns {Promise<Boolean>}
 */
const _CanManageRoles = async (roles, member) => {
    if (roles.length === 0) return false;

    // Get all managers owned by the user which also have at least
    //  one of the roles that it needs to manage
    const managerRows = await Database.GetRows("role", {
        "guildId": member.guild.id,
        "roleId": {
            [Sequelize.Op.or]: member.roles.cache.keys()
        },
        "manageableRoles": {
            [Sequelize.Op.or]: roles.map(val => {
                return { [Sequelize.Op.like]: `%;${val};%` };
            })
        }
    });

    // Get the list of all roles that aren't manageable by the user
    const disallowedRoles = roles.slice();
    for (const managerRow of managerRows) {
        // If no role is disallowed then we can stop
        if (disallowedRoles.length === 0) break;
        // For each currently disallowed role check if it is allowed
        //  by the current manager if so remove it from the list
        for (let i = disallowedRoles.length - 1; i >= 0; i--) {
            const isAllowed = managerRow.manageableRoles.includes(`;${disallowedRoles[i]};`);
            if (isAllowed) disallowedRoles.splice(i, 1);
        }
    }

    // If no role is disallowed then the user can manage all of them
    return disallowedRoles.length === 0;
};

module.exports = CreateCommand({
    "name": "role",
    "canExecute": async (msg, guild, locale) =>
        !await ReplyIfBlacklisted(locale, "role", msg, "inRoleAccessList", "isRoleAccessBlacklist"),
    "subcommands": [
        {
            "name": "managers",
            "permissions": Permissions.FLAGS.ADMINISTRATOR,
            "subcommands": [
                {
                    "name": "add",
                    "arguments": [
                        {
                            "name": "[ROLE MENTION/ID]",
                            "types": [ "role" ]
                        },
                        {
                            "name": "[ROLE MENTION/ID]",
                            "types": [ "role" ],
                            "isVariadic": true
                        }
                    ],
                    "execute": async (msg, guild, locale, [ targetId, rolesToAdd ]) => {
                        const targetRole = msg.guild.roles.resolve(targetId);
                        if (targetRole == null) {
                            await msg.reply(locale.Get("noTargetRole"));
                            return;
                        }

                        const managerRow = await Database.GetOrCreateRow("role", { "guildId": msg.guildId, "roleId": targetId });
                        const manageableRoles = _StringListToArray(managerRow.manageableRoles ?? "");

                        /** @type {String[]} */
                        const addedRoles = [ ];
                        for (let i = 0; i < rolesToAdd.length; i++) {
                            const roleId = rolesToAdd[i];
                            const role = msg.guild.roles.resolve(roleId);
                            if (role === null || manageableRoles.includes(roleId))
                                continue;

                            manageableRoles.push(roleId);
                            addedRoles.push(locale.GetCommonFormatted(
                                "roleListEntry", role.name, roleId
                            ));
                        }

                        if (addedRoles.length === 0) {
                            await msg.reply(locale.Get("noRoleAdded"));
                            return;
                        }

                        if (manageableRoles.length > DatabaseDefinitions.MAX_MANAGEABLE_ROLES) {
                            await msg.reply(locale.GetFormatted(
                                "maxManagersExceeded", DatabaseDefinitions.MAX_MANAGEABLE_ROLES, manageableRoles.length
                            ));
                            return;
                        }

                        await Database.SetRowAttr("role", {
                            "guildId": msg.guildId, "roleId": targetId
                        }, { "manageableRoles": _ArrayToStringList(manageableRoles) });

                        await msg.reply(Utils.JoinArray([
                            locale.Get("rolesAdded"), ...addedRoles
                        ], "\n"));
                    }
                },
                {
                    "name": "remove",
                    "arguments": [
                        {
                            "name": "[ROLE MENTION/ID]",
                            "types": [ "role" ]
                        },
                        {
                            "name": "[ROLE MENTION/ID]",
                            "types": [ "role" ],
                            "isVariadic": true
                        }
                    ],
                    "subcommands": [{
                        "name": "all",
                        "arguments": [{
                            "name": "[ROLE MENTION/ID]",
                            "types": [ "role" ]
                        }],
                        "execute": async (msg, guild, locale, [ targetId ]) => {
                            await Database.SetRowAttr("role",
                                { "guildId": msg.guildId, "roleId": targetId },
                                { "manageableRoles": null }
                            );
                            await msg.reply(locale.Get("allRolesRemoved"));
                        }
                    }],
                    "execute": async (msg, guild, locale, [ targetId, rolesToRemove ]) => {
                        const targetRole = msg.guild.roles.resolve(targetId);
                        if (targetRole == null) {
                            await msg.reply(locale.Get("noTargetRole"));
                            return;
                        }

                        const managerRow = await Database.GetOrCreateRow("role", { "guildId": msg.guildId, "roleId": targetId });
                        let manageableRoles = _StringListToArray(managerRow.manageableRoles ?? "");

                        /** @type {String[]} */
                        const removedRoles = [ ];
                        for (let i = 0; i < rolesToRemove.length; i++) {
                            const roleId = rolesToRemove[i];
                            const role = msg.guild.roles.resolve(roleId);
                            if (role === null)
                                continue;
                            
                            const newRoles = manageableRoles.filter(val => val !== roleId);
                            if (newRoles.length === manageableRoles.length)
                                continue;

                            manageableRoles = newRoles;
                            removedRoles.push(locale.GetCommonFormatted(
                                "roleListEntry", role.name, roleId
                            ));
                        }

                        if (removedRoles.length === 0) {
                            await msg.reply(locale.Get("noRoleRemoved"));
                            return;
                        }

                        await Database.SetRowAttr("role", {
                            "guildId": msg.guildId, "roleId": targetId
                        }, { "manageableRoles": manageableRoles.length === 0 ? null : _ArrayToStringList(manageableRoles) });

                        await msg.reply(Utils.JoinArray([
                            locale.Get("rolesRemoved"), ...removedRoles
                        ], "\n"));
                    }
                },
                {
                    "name": "list",
                    "arguments": [
                        {
                            "name": "[ROLE MENTION/ID]",
                            "types": [ "role" ]
                        }
                    ],
                    "subcommands": [{
                        "name": "all",
                        "execute": async (msg, guild, locale) => {
                            const managerRows = await Database.GetRows("role", {
                                "guildId": msg.guildId,
                                "manageableRoles": {
                                    [Sequelize.Op.ne]: null
                                }
                            });

                            if (managerRows.length === 0) {
                                await msg.reply(locale.Get("noManager"));
                                return;
                            }

                            let response = locale.Get("roleManagersList") + "\n";
                            for (const managerRow of managerRows) {
                                const managerRole = msg.guild.roles.resolve(managerRow.roleId);
                                response += locale.GetCommonFormatted(
                                    "softMention", managerRole?.name ?? locale.GetCommon("unknownRole"), managerRow.roleId
                                ) + "\n";

                                for (const manageableRoleId of _StringListToArray(managerRow.manageableRoles)) {
                                    const manageableRole = msg.guild.roles.resolve(manageableRoleId);
                                    response += locale.GetCommonFormatted(
                                        "roleListEntry", manageableRole?.name ?? locale.GetCommon("unknownRole"), manageableRoleId
                                    ) + "\n";
                                }
                            }

                            await msg.reply(response);
                        }
                    }],
                    "execute": async (msg, guild, locale, [ managerId ]) => {
                        const managerRow = await Database.GetRow("role", { "guildId": msg.guildId, "roleId": managerId });

                        if (managerRow == null || managerRow.manageableRoles == null) {
                            await msg.reply(locale.Get("noManageable"));
                            return;
                        }

                        const managerRole = msg.guild.roles.resolve(managerRow.roleId);
                        let response = (
                            locale.Get("roleManageableList") + "\n" +
                            locale.GetCommonFormatted(
                                "softMention", managerRole?.name ?? locale.GetCommon("unknownRole"), managerRow.roleId
                            ) + "\n"
                        );

                        for (const manageableRoleId of _StringListToArray(managerRow.manageableRoles)) {
                            const managerRole = msg.guild.roles.resolve(manageableRoleId);
                            response += locale.GetCommonFormatted(
                                "roleListEntry", managerRole?.name ?? locale.GetCommon("unknownRole"), manageableRoleId
                            ) + "\n";
                        }

                        await msg.reply(response);
                    }
                },
                {
                    "name": "clear",
                    "execute": async (msg, guild, locale) => {
                        await Database.SetRowsAttr("role",
                            { "guildId": msg.guildId },
                            { "manageableRoles": null }
                        );
                        await msg.reply(locale.Get("allManagersRemoved"));
                    }
                }
            ]
        },
        {
            "name": "add",
            "arguments": [
                {
                    "name": "[USER MENTION/ID]",
                    "types": [ "user" ]
                },
                {
                    "name": "[ROLE MENTION/ID]",
                    "types": [ "role" ],
                    "isVariadic": true
                }
            ],
            "execute": async (msg, guild, locale, [ targetId, rolesToGive ]) => {
                if (rolesToGive.length === 0) {
                    await msg.reply(locale.Get("noRoleSpecified"));
                    return;
                }

                if (!(msg.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR) || await _CanManageRoles(rolesToGive, msg.member))) {
                    await msg.reply(locale.Get("cantAddAll"));
                    return;
                }

                const targetMember = msg.guild.members.resolve(targetId);
                if (targetMember === null) {
                    await msg.reply(locale.Get("userNotFound"));
                    return;
                }

                try {
                    await targetMember.roles.add(rolesToGive, `Roles added by ${msg.member.id}`);
                    await msg.reply(locale.Get("rolesAdded"));
                } catch (error) {
                    await msg.reply(locale.Get("notEnoughPermissionsToAdd"));
                }
            }
        },
        {
            "name": "remove",
            "arguments": [
                {
                    "name": "[USER MENTION/ID]",
                    "types": [ "user" ]
                },
                {
                    "name": "[ROLE MENTION/ID]",
                    "types": [ "role" ],
                    "isVariadic": true
                }
            ],
            "execute": async (msg, guild, locale, [ targetId, rolesToRemove ]) => {
                if (rolesToRemove.length === 0) {
                    await msg.reply(locale.Get("noRoleSpecified"));
                    return;
                }

                if (!(msg.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR) || await _CanManageRoles(rolesToRemove, msg.member))) {
                    await msg.reply(locale.Get("cantRemoveAll"));
                    return;
                }

                const targetMember = msg.guild.members.resolve(targetId);
                if (targetMember === null) {
                    await msg.reply(locale.Get("userNotFound"));
                    return;
                }

                try {
                    await targetMember.roles.remove(rolesToRemove, `Roles removed by ${msg.member.id}`);
                    await msg.reply(locale.Get("rolesRemoved"));
                } catch (error) {
                    await msg.reply(locale.Get("notEnoughPermissionsToRemove"));
                }
            }
        }
    ]
});