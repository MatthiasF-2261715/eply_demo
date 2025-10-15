const express = require('express');
const router = express.Router();
const { GRAPH_ME_ENDPOINT } = require('../auth/authConfig');
const { isAuthenticated } = require('../middleware/auth');
const { getInboxEmails, getSentEmails } = require('../services/emailService');
const { createImapDraft, createOutlookDraft } = require('../services/draftService');
const { getAssistantByEmail, isUserWhitelisted } = require('../database');
const { useAssistant } = require('../assistant');
const { filterHtmlContent } = require('../services/htmlFilterService');
const { validateEmail } = require('../services/emailValidationService');

router.get('/id', isAuthenticated, async (req, res) => {
    res.render('id', { idTokenClaims: req.session.account?.idTokenClaims });
});

router.get('/profile', isAuthenticated, async function (req, res, next) {
    if (req.session.method === 'outlook') {
        try {
            if (!req.session.accessToken) {
                return res.status(401).json({ error: 'No access token in session' });
            }
            
            const response = await fetch(GRAPH_ME_ENDPOINT, {
                headers: {
                    'Authorization': `Bearer ${req.session.accessToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`Graph API error: ${response.status}`);
            }
            
            const graphResponse = await response.json();
            
            res.json({
                profile: graphResponse,
                username: graphResponse.displayName || graphResponse.mail || graphResponse.userPrincipalName
            });
        } catch (error) {
            console.error('Profile fetch error:', error);
            if (error.message && error.message.includes('401')) {
                return res.status(401).json({ error: 'Access token expired or invalid' });
            }
            res.status(500).json({ error: 'Error fetching profile' });
        }
    } else if (req.session.method === 'imap') {
        if (!req.session.imap) {
            return res.status(401).json({ error: 'Niet ingelogd via IMAP.' });
        }
        const { email, imapServer } = req.session.imap;
        res.json({
            profile: { email, imapServer },
            username: email
        });
    } else {
        res.status(401).json({ error: 'Niet ingelogd.' });
    }
});

router.get('/mails', isAuthenticated, async function(req, res, next) {
    if (!req.session.method) {
        return res.status(401).json({ error: 'Niet ingelogd.' });
    }
    
    try {
        const mails = await getInboxEmails(req.session.method, req.session);
        res.json({ mails });
    } catch (error) {
        console.error('Error fetching mails:', error);
        res.status(500).json({ error: error.message });
    }
});

function getSessionEmail(req) {
    return req.session.email || req.session?.imap?.email || req.session?.account?.username;
}

router.get('/isWhitelisted', isAuthenticated, async (req,res) => {
    const email = getSessionEmail(req);
    if (!email) return res.status(400).json({ error: 'Geen e-mailadres in sessie.' });
    try {
      const ok = await isUserWhitelisted(email);
      if (ok) return res.json({ whitelisted: true });
      
      // Niet whitelisted -> automatisch uitloggen
      if (req.session) {
        req.session.destroy(err => {
          if (err) console.error('Session destroy error (not whitelisted):', err);
          res.clearCookie('connect.sid');
          return res.status(403).json({ 
            error: 'User is not whitelisted. Uitgelogd.',
            whitelisted: false,
            loggedOut: true
          });
        });
      } else {
        return res.status(403).json({ 
          error: 'User is not whitelisted. (Geen sessie)',
          whitelisted: false,
          loggedOut: true
        });
      }
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Interne fout.' });
    }
  });

router.post('/ai/reply', isAuthenticated, async function (req, res) {
    let { email, title, content, originalMailId, force } = req.body;
    const sessionEmail = getSessionEmail(req);
    if (!email || !content) {
        return res.status(400).json({ error: 'Email en content zijn verplicht.' });
    }

    if (!force) {
        const isValid = await validateEmail(email, content);
        if (!isValid) {
            return res.json({ skip: true });
        }
    }

    if (req.session.method === 'outlook') {
        content = filterHtmlContent(content);
    }

    try {
        const sentEmails = await getSentEmails(req.session.method, req.session);
        const assistantObj = await getAssistantByEmail(sessionEmail);
        const assistantId = assistantObj.assistant_id || assistantObj.id;
        
        const currentEmail = { from: content, title };
        const aiResponse = await useAssistant(assistantId, currentEmail, sentEmails);
        
        
        if (originalMailId) {
            if (req.session.method === 'imap') {
                await createImapDraft(req.session, aiResponse, originalMailId, content);
            } else if (req.session.method === 'outlook') {
                await createOutlookDraft(req.session, aiResponse, originalMailId);
            }
        }
        
        res.json({ response: aiResponse });
    } catch (err) {
        console.error('Error in /ai/reply:', err);
        res.status(500).json({ error: err.message || 'AI response error' });
    }
});


module.exports = router;