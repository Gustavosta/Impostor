import eris from "eris";
import { LobbyRegion, SessionState } from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import { SessionChannelType } from "./database/session-channel";
import { getMembersInChannel } from "./listeners";

const LOADING = 0x36393f;
const INFO = 0x0a96de;
const ERROR = 0xfd5c5c;
const WARN = 0xed872d;

/**
 * Creates a new loading message as response to the specified message
 * and creates a new empty session with the specified region and code.
 * The session does not start automatically and needs to be started using
 * the session runner.
 */
export async function createEmptyNewSession(
    msg: eris.Message,
    region: LobbyRegion,
    code: string
): Promise<AmongUsSession> {
    const message = await msg.channel.createMessage({
        embed: {
            color: LOADING,
            description: `<a:loading:572067799535452171> Attempting to connect to lobby \`${code}\` on ${region}...`,
        },
    });

    // Create a new session.
    const session = new AmongUsSession();
    session.guild = (msg.channel as eris.TextChannel).guild.id;
    session.channel = msg.channel.id;
    session.message = message.id;
    session.user = msg.author.username;
    session.state = SessionState.LOBBY;
    session.region = region;
    session.lobbyCode = code;
    await orm.em.persist(session);
    await orm.em.flush();

    return session;
}

/**
 * Moves all players in `idFrom` to `idTo`.
 */
async function movePlayers(bot: eris.Client, session: AmongUsSession, idFrom: string, idTo: string) {
    await Promise.all(
        getMembersInChannel(idFrom).map(x =>
            bot.editGuildMember(session.guild, x, {
                channelID: idTo,
            })
        )
    );
}

/**
 * Moves all players currently in the silence channel of the given
 * among us session to the relevant talking channel.
 */
export async function movePlayersToTalkingChannel(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();

    const talkingChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;
    const silenceChannel = session.channels.getItems().find(x => x.type === SessionChannelType.SILENCE)!;

    await movePlayers(bot, session, silenceChannel.channelId, talkingChannel.channelId);
}

/**
 * Moves all players currently in the talking channel of the given
 * among us session to the relevant silence channel.
 */
export async function movePlayersToSilenceChannel(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();

    const talkingChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;
    const silenceChannel = session.channels.getItems().find(x => x.type === SessionChannelType.SILENCE)!;

    await movePlayers(bot, session, talkingChannel.channelId, silenceChannel.channelId);
}

/**
 * Updates the message of the specified session with the notion
 * that an error occurred during connecting. Does not remove the
 * session itself.
 */
export async function updateMessageWithError(bot: eris.Client, session: AmongUsSession, error: string) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Error`,
            description: `${error}`,
        },
    });
}

/**
 * Updates the message of the specified session with the notion
 * that the session is over because the lobby was closed. Does not
 * remove the session itself.
 */
export async function updateMessageWithSessionOver(bot: eris.Client, session: AmongUsSession) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Session Over`,
            description: `${session.user} was hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php) here, but the lobby closed.`,
        },
    });
}

/**
 * Updates the message for the specified among us session to the
 * relevant content for the current session state. Should be invoked
 * after the state of the session was changed.
 */
export async function updateMessage(bot: eris.Client, session: AmongUsSession) {
    if (session.state === SessionState.LOBBY) {
        await updateMessageToLobby(bot, session);
    }

    if (session.state === SessionState.PLAYING || session.state === SessionState.DISCUSSING) {
        await updateMessageToPlaying(bot, session);
    }
}

/**
 * Updates the message of the specified session to the content that
 * the match is currently ongoing.
 */
async function updateMessageToPlaying(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();
    const mainChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;

    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: WARN,
            title: `🎲 Among Us - ${session.region} - ${session.lobbyCode} (In Game)`,
            description: `${session.user} is hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php)! Join the voice channel <#${mainChannel.channelId}> or click [here](https://discord.gg/${mainChannel.invite}) to join the voice chat. ~~To join the Among Us lobby, select the **${session.region}** server and enter code \`${session.lobbyCode}\`.~~ The lobby is currently ongoing! You'll need to wait for the round to end before you can join.`,
            footer: {
                icon_url:
                    "https://cdn.discordapp.com/icons/579772930607808537/2d2607a672f2529206edd929ef55173e.png?size=128",
                text: "Reminder: the bot takes up a player spot!",
            },
        },
    });
}

/**
 * Updates the message of the specified session to the content that the
 * session is currently in the lobby and that players are free to join.
 */
async function updateMessageToLobby(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();
    const mainChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;

    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: INFO,
            title: `🎲 Among Us - ${session.region} - ${session.lobbyCode}`,
            description: `${session.user} is hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php)! Join the voice channel <#${mainChannel.channelId}> or click [here](https://discord.gg/${mainChannel.invite}) to join the voice chat. To join the Among Us lobby, select the **${session.region}** server and enter code \`${session.lobbyCode}\`.`,
            footer: {
                icon_url:
                    "https://cdn.discordapp.com/icons/579772930607808537/2d2607a672f2529206edd929ef55173e.png?size=128",
                text: "Reminder: the bot takes up a player spot!",
            },
        },
    });
}