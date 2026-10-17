// Widget chat Julie — Loc'Air
// Insérer via : <script src="/chat-widget.js" defer></script>
// Bot Joe (vendeur) : <script src="/chat-widget.js" data-bot="joe" defer></script>
// S'injecte automatiquement dans la page sans rien casser.
(function () {
  'use strict';

  // ── Choix du bot (attribut data-bot du <script>) ───────────────────────
  var BOTS = {
    julie: {
      name:       'Julie',
      sub:        'Assistante Loc\'Air · répond en quelques secondes',
      avatar:     '💬',
      greeting:   'Bonjour ! Je suis Julie, l\'assistante de Loc\'Air. Comment puis-je vous aider ? 😊',
      endpoint:   '/api/chat',
      sessionKey: 'julie_session',
      suggestions: [
        { emoji: '📅', label: 'Réserver un climatiseur' },
        { emoji: '⏰', label: 'Prolonger ma location' },
        { emoji: '💰', label: 'Tarifs et disponibilités' },
        { emoji: '🔧', label: 'Problème / panne' },
        { emoji: '🏠', label: 'Zone de livraison' },
      ],
    },
    joe: {
      name:       'Joe',
      sub:        'Conseiller Loc\'Air · trouve le bon clim pour vous',
      avatar:     '🤝',
      greeting:   'Bonjour, moi c\'est Joe ! Je vais vous aider à trouver le climatiseur parfait. À qui ai-je le plaisir de parler ? 😊',
      endpoint:   '/api/chat-joe',
      sessionKey: 'joe_session',
      suggestions: [
        { emoji: '🌡️', label: 'J\'ai trop chaud, que me conseillez-vous ?' },
        { emoji: '💰', label: 'Combien ça coûte ?' },
        { emoji: '🆚', label: 'Mobile ou PortaSplit ?' },
        { emoji: '📅', label: 'Je veux réserver' },
      ],
    },
  };
  var script = document.currentScript;
  var BOT = BOTS[(script && script.getAttribute('data-bot')) || 'julie'] || BOTS.julie;

  // ── Session (localStorage) ─────────────────────────────────────────────
  function getSession() {
    try {
      var s = localStorage.getItem(BOT.sessionKey);
      if (s && /^[a-zA-Z0-9_-]{8,64}$/.test(s)) return s;
      s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem(BOT.sessionKey, s);
      return s;
    } catch (_) {
      return 'anon_' + Math.random().toString(36).slice(2);
    }
  }

  // ── HTML du widget ─────────────────────────────────────────────────────
  var SUGGESTIONS = BOT.suggestions;

  var CSS = `
#jw-btn{position:fixed;bottom:24px;right:90px;width:52px;height:52px;border-radius:50%;
  background:#086E60;color:#fff;border:none;cursor:pointer;z-index:8900;
  box-shadow:0 4px 18px rgba(8,110,96,.45);display:flex;align-items:center;justify-content:center;
  transition:transform .2s,box-shadow .2s;padding:0}
#jw-btn:hover{transform:scale(1.08);box-shadow:0 6px 26px rgba(8,110,96,.55)}
#jw-btn svg{width:26px;height:26px;fill:currentColor}
#jw-panel{position:fixed;bottom:88px;right:16px;width:340px;height:480px;max-height:calc(100vh - 110px);
  background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);
  z-index:8900;display:flex;flex-direction:column;overflow:hidden;
  transform:scale(.9) translateY(20px);opacity:0;pointer-events:none;
  transition:transform .25s cubic-bezier(.4,0,.2,1),opacity .25s}
#jw-panel.jw-open{transform:scale(1) translateY(0);opacity:1;pointer-events:auto}
#jw-head{background:#086E60;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
#jw-head-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);
  display:flex;align-items:center;justify-content:center;font-size:18px}
#jw-head-text{flex:1}
#jw-head-name{font-weight:700;font-size:14px}
#jw-head-sub{font-size:11px;opacity:.8}
#jw-close{background:none;border:none;color:#fff;cursor:pointer;width:30px;height:30px;
  border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;
  opacity:.8;transition:opacity .15s;padding:0;flex-shrink:0}
#jw-close:hover{opacity:1}
#jw-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px;background:#f0f2f5}
.jw-msg{max-width:80%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.45;word-break:break-word}
.jw-msg-julie{align-self:flex-start;background:#fff;border-radius:4px 14px 14px 14px;color:#0E1F35}
.jw-msg-user{align-self:flex-end;background:#dcf8c6;border-radius:14px 14px 4px 14px;color:#0E1F35}
.jw-typing{display:flex;gap:4px;align-items:center;padding:8px 12px}
.jw-dot{width:7px;height:7px;border-radius:50%;background:#aaa;animation:jw-bounce .9s infinite ease-in-out}
.jw-dot:nth-child(2){animation-delay:.15s}
.jw-dot:nth-child(3){animation-delay:.3s}
@keyframes jw-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
#jw-footer{background:#fff;border-top:1px solid #e6ebf1;padding:10px;display:flex;gap:8px;align-items:flex-end;flex-shrink:0}
#jw-input{flex:1;border:1.5px solid #e6ebf1;border-radius:22px;padding:9px 14px;font-size:13px;
  resize:none;outline:none;max-height:80px;font-family:inherit;line-height:1.4;color:#0E1F35}
#jw-input:focus{border-color:#086E60}
#jw-send{width:36px;height:36px;border-radius:50%;background:#086E60;color:#fff;border:none;
  cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  transition:background .15s;padding:0}
#jw-send:hover{background:#065a4f}
#jw-send svg{width:18px;height:18px;fill:currentColor}
#jw-wa-link{text-align:center;padding:6px 0;font-size:11px;color:#888;flex-shrink:0;background:#fff}
#jw-wa-link a{color:#25D366;font-weight:600;text-decoration:none}
#jw-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 6px;background:#f0f2f5;flex-shrink:0}
.jw-chip{background:#fff;border:1.5px solid #d1d5db;border-radius:18px;padding:6px 12px;font-size:12px;
  color:#086E60;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s;font-family:inherit}
.jw-chip:hover{background:#e7f3f0;border-color:#086E60}
#jw-badge{position:absolute;top:-3px;right:-3px;width:16px;height:16px;border-radius:50%;
  background:#ef4444;color:#fff;font-size:10px;font-weight:700;display:flex;
  align-items:center;justify-content:center;opacity:0;transition:opacity .2s}
@media(max-width:400px){
  #jw-panel{width:calc(100vw - 16px);right:8px;bottom:88px}
  #jw-btn{right:72px;width:48px;height:48px}
}
`;

  var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  var session = getSession();
  var open    = false;
  var sending = false;

  function injectWidget() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'jw-btn';
    btn.setAttribute('aria-label', 'Chat avec ' + BOT.name);
    btn.innerHTML = ICON_CHAT + '<span id="jw-badge"></span>';
    document.body.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'jw-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat avec ' + BOT.name);
    panel.innerHTML = `
      <div id="jw-head">
        <div id="jw-head-avatar">${BOT.avatar}</div>
        <div id="jw-head-text">
          <div id="jw-head-name">${BOT.name}</div>
          <div id="jw-head-sub">${BOT.sub}</div>
        </div>
        <button id="jw-close" aria-label="Fermer">×</button>
      </div>
      <div id="jw-msgs"></div>
      <div id="jw-suggestions"></div>
      <div id="jw-footer">
        <textarea id="jw-input" placeholder="Écrivez votre question…" rows="1" maxlength="1000"></textarea>
        <button id="jw-send" aria-label="Envoyer">${ICON_SEND}</button>
      </div>
      <div id="jw-wa-link">ou <a href="https://wa.me/33663798756?text=Bonjour%2C+j%27ai+une+question." target="_blank" rel="noopener">écrire sur WhatsApp</a></div>
    `;
    document.body.appendChild(panel);

    btn.addEventListener('click', togglePanel);
    document.getElementById('jw-close').addEventListener('click', closePanel);
    document.getElementById('jw-send').addEventListener('click', sendMessage);
    document.getElementById('jw-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('jw-input').addEventListener('input', autoResize);
  }

  function togglePanel() { open ? closePanel() : openPanel(); }

  function openPanel() {
    open = true;
    document.getElementById('jw-panel').classList.add('jw-open');
    hideBadge();
    if (!document.getElementById('jw-msgs').children.length) {
      addBubble('julie', BOT.greeting);
      showSuggestions();
    }
    setTimeout(function() { document.getElementById('jw-input').focus(); }, 250);
  }

  function closePanel() {
    open = false;
    document.getElementById('jw-panel').classList.remove('jw-open');
  }

  function addBubble(role, text) {
    var msgs = document.getElementById('jw-msgs');
    var div  = document.createElement('div');
    div.className = 'jw-msg jw-msg-' + role;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showTyping() {
    var msgs = document.getElementById('jw-msgs');
    var div  = document.createElement('div');
    div.className = 'jw-msg jw-msg-julie jw-typing';
    div.id = 'jw-typing';
    div.innerHTML = '<div class="jw-dot"></div><div class="jw-dot"></div><div class="jw-dot"></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function hideTyping() {
    var t = document.getElementById('jw-typing');
    if (t) t.remove();
  }

  function showBadge() {
    var b = document.getElementById('jw-badge');
    if (b) { b.textContent = '1'; b.style.opacity = '1'; }
  }

  function hideBadge() {
    var b = document.getElementById('jw-badge');
    if (b) b.style.opacity = '0';
  }

  function showSuggestions() {
    var el = document.getElementById('jw-suggestions');
    if (!el) return;
    el.innerHTML = SUGGESTIONS.map(function(s) {
      return '<button class="jw-chip" data-msg="' + s.label + '">' + s.emoji + ' ' + s.label + '</button>';
    }).join('');
    el.querySelectorAll('.jw-chip').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var msg = btn.getAttribute('data-msg');
        hideSuggestions();
        document.getElementById('jw-input').value = msg;
        sendMessage();
      });
    });
  }

  function hideSuggestions() {
    var el = document.getElementById('jw-suggestions');
    if (el) el.innerHTML = '';
  }

  function autoResize() {
    var el = document.getElementById('jw-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }

  async function sendMessage() {
    if (sending) return;
    var input = document.getElementById('jw-input');
    var text  = (input.value || '').trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    hideSuggestions();
    addBubble('user', text);
    showTyping();
    sending = true;

    try {
      var r = await fetch(BOT.endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ session_id: session, message: text }),
      });
      var d = await r.json();
      hideTyping();
      addBubble('julie', d.reply || 'Désolée, une erreur est survenue. Contactez-nous au 06 63 79 87 56.');
      if (!open) showBadge();
    } catch (_) {
      hideTyping();
      addBubble('julie', 'Connexion perdue. Vérifiez votre réseau ou contactez-nous directement.');
    } finally {
      sending = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWidget);
  } else {
    injectWidget();
  }
})();
