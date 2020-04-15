let stop;

function requestLocalStorage(param, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { localStorage: param }, callback)
    })
}

const logArea = document.querySelector('pre');
const startBtn = document.querySelector('button#start');
const stopBtn = document.querySelector('button#stop');
const autoScroll = document.querySelector('#autoScroll');
startBtn.onclick = e => {
    const authToken = document.querySelector('input#authToken').value.trim();
    const authorId = document.querySelector('input#authorId').value.trim();
    const guildId = document.querySelector('input#guildId').value.trim();
    const channelId = document.querySelector('input#channelId').value.trim();
    const afterMessageId = document.querySelector('input#afterMessageId').value.trim();
    const beforeMessageId = document.querySelector('input#beforeMessageId').value.trim();
    const content = document.querySelector('input#content').value.trim();
    const hasLink = document.querySelector('input#hasLink').checked;
    const hasFile = document.querySelector('input#hasFile').checked;
    const includeNsfw = document.querySelector('input#includeNsfw').checked;
    stop = stopBtn.disabled = !(startBtn.disabled = true);
    deleteMessages(authToken, authorId, guildId, channelId, afterMessageId, beforeMessageId, content, hasLink, hasFile, includeNsfw, logger, () => !(stop === true || closed)).then(() => {
        stop = stopBtn.disabled = !(startBtn.disabled = false);
    });
};
stopBtn.onclick = e => stop = stopBtn.disabled = !(startBtn.disabled = false);
document.querySelector('button#clear').onclick = e => { logArea.innerHTML = ''; };
document.querySelector('button#getToken').onclick = e => {
    requestLocalStorage("token", function (response) {
        document.querySelector('input#authToken').value = JSON.parse(response.result);
    })    
};
document.querySelector('button#getAuthor').onclick = e => {
    requestLocalStorage("user_id_cache", function(response) {
        document.querySelector('input#authorId').value = JSON.parse(response.result);
    })
};
document.querySelector('button#getGuildAndChannel').onclick = e => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const url = tabs[0].url
        const m = url.match(/channels\/([\w@]+)\/(\d+)/)
        if (!m) {
            alert('Please open a chat room first')
            return
        }

        document.querySelector('input#guildId').value = m[1];
        document.querySelector('input#channelId').value = m[2];
    })
};
document.querySelector('#redact').onchange = e => {
    document.body.classList.toggle('redact') &&
        alert('This will attempt to hide personal information, but make sure to double check before sharing screenshots.');
};

const logger = (type = '', args) => {
    const style = { '': '', info: 'color:#00b0f4;', verb: 'color:#72767d;', warn: 'color:#faa61a;', error: 'color:#f04747;', success: 'color:#43b581;' }[type];
    logArea.insertAdjacentHTML('beforeend', `<div style="${style}">${Array.from(args).map(o => typeof o === 'object' ? JSON.stringify(o, o instanceof Error && Object.getOwnPropertyNames(o)) : o).join('\t')}</div>`);
    if (autoScroll.checked) logArea.querySelector('div:last-child').scrollIntoView(false);
};

// return 'Looking good!';
/**
 * Delete all messages in a Discord channel or DM
 * @param {string} authToken Your authorization token
 * @param {string} authorId Author of the messages you want to delete
 * @param {string} guildId Server were the messages are located
 * @param {string} channelId Channel were the messages are located
 * @param {string} afterMessageId Only delete messages after this, leave blank do delete all
 * @param {string} beforeMessageId Only delete messages before this, leave blank do delete all
 * @param {string} content Filter messages that contains this text content
 * @param {boolean} hasLink Filter messages that contains link
 * @param {boolean} hasFile Filter messages that contains file
 * @param {boolean} includeNsfw Search in NSFW channels
 * @param {function(string, Array)} extLogger Function for logging
 * @param {function} stopHndl stopHndl used for stopping
 * @author Victornpb <https://www.github.com/victornpb>
 * @see https://github.com/victornpb/deleteDiscordMessages
 */
async function deleteMessages(authToken, authorId, guildId, channelId, afterMessageId, beforeMessageId, content, hasLink, hasFile, includeNsfw, extLogger, stopHndl) {
    const start = new Date();
    let deleteDelay = 100;
    let searchDelay = 100;
    let delCount = 0;
    let failCount = 0;
    let avgPing;
    let lastPing;
    let grandTotal;
    let throttledCount = 0;
    let throttledTotalTime = 0;
    let offset = 0;
    let iterations = -1;

    const wait = async ms => new Promise(done => setTimeout(done, ms));
    const msToHMS = s => `${s / 3.6e6 | 0}h ${(s % 3.6e6) / 6e4 | 0}m ${(s % 6e4) / 1000 | 0}s`;
    const escapeHTML = html => html.replace(/[&<"']/g, m => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', '\'': '&#039;' })[m]);
    const redact = str => `<span class="priv">${escapeHTML(str)}</span><span class="mask">REDACTED</span>`;
    const queryString = params => params.filter(p => p[1] !== undefined).map(p => p[0] + '=' + encodeURIComponent(p[1])).join('&');
    const ask = async msg => new Promise(resolve => setTimeout(() => resolve(confirm(msg)), 10));
    const printDelayStats = () => log.verb(`Delete delay: ${deleteDelay}ms, Search delay: ${searchDelay}ms`, `Last Ping: ${lastPing}ms, Average Ping: ${avgPing | 0}ms`);

    const log = {
        debug() { extLogger ? extLogger('debug', arguments) : console.debug.apply(console, arguments); },
        info() { extLogger ? extLogger('info', arguments) : console.info.apply(console, arguments); },
        verb() { extLogger ? extLogger('verb', arguments) : console.log.apply(console, arguments); },
        warn() { extLogger ? extLogger('warn', arguments) : console.warn.apply(console, arguments); },
        error() { extLogger ? extLogger('error', arguments) : console.error.apply(console, arguments); },
        success() { extLogger ? extLogger('success', arguments) : console.info.apply(console, arguments); },
    };

    async function recurse() {
        iterations++;

        let API_SEARCH_URL;
        if (guildId === '@me') {
            API_SEARCH_URL = `https://discordapp.com/api/v6/channels/${channelId}/messages/`; // DMs
        }
        else {
            API_SEARCH_URL = `https://discordapp.com/api/v6/guilds/${guildId}/messages/`; // Server
        }

        const headers = {
            'Authorization': authToken
        };

        let resp;
        try {
            const s = Date.now();
            resp = await fetch(API_SEARCH_URL + 'search?' + queryString([
                ['author_id', authorId || undefined],
                ['channel_id', (guildId !== '@me' ? channelId : undefined) || undefined],
                ['min_id', afterMessageId || undefined],
                ['max_id', beforeMessageId || undefined],
                ['sort_by', 'timestamp'],
                ['sort_order', 'desc'],
                ['offset', offset],
                ['has', hasLink ? 'link' : undefined],
                ['has', hasFile ? 'file' : undefined],
                ['content', content || undefined],
                ['include_nsfw', includeNsfw ? true : undefined],
            ]), { headers });
            lastPing = (Date.now() - s);
            avgPing = avgPing > 0 ? (avgPing * 0.9) + (lastPing * 0.1) : lastPing;
        } catch (err) {
            return log.error('Search request throwed an error:', err);
        }

        // not indexed yet
        if (resp.status === 202) {
            const w = (await resp.json()).retry_after;
            throttledCount++;
            throttledTotalTime += w;
            log.warn(`This channel wasn't indexed, waiting ${w}ms for discord to index it...`);
            await wait(w);
            return await recurse();
        }

        if (!resp.ok) {
            // searching messages too fast
            if (resp.status === 429) {
                const w = (await resp.json()).retry_after;
                throttledCount++;
                throttledTotalTime += w;
                searchDelay += w; // increase delay
                log.warn(`Being rate limited by the API for ${w}ms! Increasing search delay...`);
                printDelayStats();
                log.verb(`Cooling down for ${w * 2}ms before retrying...`);

                await wait(w * 2);
                return await recurse();
            } else {
                return log.error(`Error searching messages, API responded with status ${resp.status}!\n`, await resp.json());
            }
        }

        const data = await resp.json();
        const total = data.total_results;
        if (!grandTotal) grandTotal = total;
        const myMessages = data.messages.map(convo => convo.find(message => message.hit === true));
        const systemMessages = myMessages.filter(msg => msg.type !== 0); // https://discordapp.com/developers/docs/resources/channel#message-object-message-types
        const deletableMessages = myMessages.filter(msg => msg.type === 0);
        const end = () => {
            log.success(`Ended at ${new Date().toLocaleString()}! Total time: ${msToHMS(Date.now() - start.getTime())}`);
            printDelayStats();
            log.verb(`Rate Limited: ${throttledCount} times. Total time throttled: ${msToHMS(throttledTotalTime)}.`);
            log.debug(`Deleted ${delCount} messages, ${failCount} failed.\n`);
        }

        const etr = msToHMS((searchDelay * Math.round(total / 25)) + ((deleteDelay + avgPing) * total));
        log.info(`Total messages found: ${data.total_results}`, `(Messages in current page: ${data.messages.length}, Author: ${deletableMessages.length}, System: ${systemMessages.length})`, `offset: ${offset}`);
        printDelayStats();
        log.verb(`Estimated time remaining: ${etr}`)


        if (myMessages.length > 0) {

            if (iterations < 1) {
                log.verb(`Waiting for your confirmation...`);
                if (!await ask(`Do you want to delete ~${total} messages?\nEstimated time: ${etr}\n\n---- Preview ----\n` +
                    myMessages.map(m => `${m.author.username}#${m.author.discriminator}: ${m.attachments.length ? '[ATTACHMENTS]' : m.content}`).join('\n')))
                    return end(log.error('Aborted by you!'));
                log.verb(`OK`);
            }

            for (let i = 0; i < deletableMessages.length; i++) {
                const message = deletableMessages[i];
                if (stopHndl && stopHndl() === false) return end(log.error('Stopped by you!'));

                log.debug(`${((delCount + 1) / grandTotal * 100).toFixed(2)}% (${delCount + 1}/${grandTotal})`,
                    `Deleting ID:${redact(message.id)} <b>${redact(message.author.username + '#' + message.author.discriminator)} <small>(${redact(new Date(message.timestamp).toLocaleString())})</small>:</b> <i>${redact(message.content).replace(/\n/g, '↵')}</i>`,
                    message.attachments.length ? redact(JSON.stringify(message.attachments)) : '');

                let resp;
                try {
                    const s = Date.now();
                    const API_DELETE_URL = `https://discordapp.com/api/v6/channels/${channelId}/messages/`;
                    resp = await fetch(API_DELETE_URL + message.id, {
                        headers,
                        method: 'DELETE'
                    });
                    lastPing = (Date.now() - s);
                    avgPing = (avgPing * 0.9) + (lastPing * 0.1);
                    delCount++;
                } catch (err) {
                    log.error('Delete request throwed an error:', err);
                    log.verb('Related object:', redact(JSON.stringify(message)));
                    failCount++;
                }

                if (!resp.ok) {
                    // deleting messages too fast
                    if (resp.status === 429) {
                        const w = (await resp.json()).retry_after;
                        throttledCount++;
                        throttledTotalTime += w;
                        deleteDelay += w; // increase delay
                        log.warn(`Being rate limited by the API for ${w}ms! Adjusted delete delay to ${deleteDelay}ms.`);
                        printDelayStats();
                        log.verb(`Cooling down for ${w * 2}ms before retrying...`);
                        await wait(w * 2);
                        i--; // retry
                    } else {
                        log.error(`Error deleting message, API responded with status ${resp.status}!`, await resp.json());
                        log.verb('Related object:', redact(JSON.stringify(message)));
                        failCount++;
                    }
                }

                await wait(deleteDelay);
            }

            if (systemMessages.length > 0) {
                grandTotal -= systemMessages.length;
                offset += systemMessages.length;
                log.verb(`Found ${systemMessages.length} system messages! Decreasing grandTotal to ${grandTotal} and increasing offset to ${offset}.`);
            }

            log.verb(`Searching next messages in ${searchDelay}ms...`, (offset ? `(offset: ${offset})` : ''));
            await wait(searchDelay);

            if (stopHndl && stopHndl() === false) return end(log.error('Stopped by you!'));

            return await recurse();
        } else {
            if (total - offset > 0) log.warn('Ended because API returned an empty page.');
            return end();
        }
    }

    log.success(`\nStarted at ${start.toLocaleString()}`);
    log.debug(`authorId="${redact(authorId)}" guildId="${redact(guildId)}" channelId="${redact(channelId)}" afterMessageId="${redact(afterMessageId)}" beforeMessageId="${redact(beforeMessageId)}" hasLink=${!!hasLink} hasFile=${!!hasFile}`);
    return await recurse();
}
