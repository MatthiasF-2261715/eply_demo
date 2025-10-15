const fetch = require('../fetch');

async function getOutlookSentEmails(session) {
    const sentEndpoint = 'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$top=10&$orderby=sentDateTime desc';
    const response = await fetch(sentEndpoint, session.accessToken);
    return response.value || [];
}

async function getOutlookInboxEmails(session) {
    const inboxEndpoint = 'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$top=10&$orderby=receivedDateTime desc';
    const response = await fetch(inboxEndpoint, session.accessToken);
    return response.value || [];
}

module.exports = { getOutlookSentEmails, getOutlookInboxEmails };