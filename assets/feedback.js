/* BINDIG feedback widget: a small button on every page. Sends to /api/feedback. */
(function(){
  if (document.getElementById("fbBtn")) return;
  var css = "#fbBtn{position:fixed;right:16px;bottom:16px;z-index:60;background:#0A0F0C;color:#78F09A;border:1px solid #78F09A;font:700 12px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;padding:10px 14px;cursor:pointer;box-shadow:0 0 24px -6px rgba(120,240,154,.45)}"+
    "#fbBtn:hover{background:#78F09A;color:#04130A}"+
    
    "#fbDlg{border:1px solid #78F09A;background:#0A0F0C;color:#E6EEE8;padding:0;max-width:min(480px,calc(100vw - 32px));width:100%;box-shadow:0 0 80px -10px rgba(120,240,154,.45);font-family:'JetBrains Mono',ui-monospace,monospace}"+
    "#fbDlg::backdrop{background:rgba(0,0,0,.7)}#fbDlg form{padding:22px;display:grid;gap:12px}"+
    "#fbDlg h2{font:900 26px 'Doto','JetBrains Mono',monospace;text-transform:uppercase;margin:0}"+
    "#fbDlg .types{display:flex;gap:8px;flex-wrap:wrap}#fbDlg .types label{border:1px solid #1C2A21;padding:8px 12px;cursor:pointer;font-size:13px}"+
    "#fbDlg .types input{position:absolute;opacity:0;pointer-events:none}#fbDlg .types label:has(input:checked){border-color:#78F09A;color:#78F09A}"+
    "#fbDlg textarea,#fbDlg input[type=email]{font:15px 'JetBrains Mono',monospace;color:#E6EEE8;background:#050706;border:1px solid #1C2A21;padding:11px 12px;width:100%;box-sizing:border-box}"+
    "#fbDlg textarea{min-height:110px;resize:vertical}#fbDlg textarea:focus,#fbDlg input:focus{border-color:#78F09A;outline:none}"+
    "#fbDlg .row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}"+
    "#fbDlg .go{background:#78F09A;color:#04130A;border:0;font:700 13px 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;padding:13px 18px;cursor:pointer}"+
    "#fbDlg .x{background:none;border:0;color:#8A968E;cursor:pointer;font:12px 'JetBrains Mono',monospace;justify-self:end}"+
    "#fbDlg .n{font-size:12px;color:#8A968E}#fbDlg .st{font-size:13px;color:#78F09A;min-height:1em}#fbDlg .st.err{color:#FF5E57}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  var b = document.createElement("button"); b.id = "fbBtn"; b.type = "button"; b.textContent = "Feedback"; document.body.appendChild(b);
  var d = document.createElement("dialog"); d.id = "fbDlg"; d.setAttribute("aria-labelledby","fbTitle");
  d.innerHTML = '<form><button type="button" class="x" id="fbX">close ✕</button><h2 id="fbTitle">Tell us what you think</h2>'+
    '<p class="n">We\'re in beta and read everything.</p>'+
    '<div class="types" role="radiogroup" aria-label="Type"><label><input type="radio" name="fbType" value="idea" checked>💡 Idea</label><label><input type="radio" name="fbType" value="issue">🐞 Issue</label><label><input type="radio" name="fbType" value="praise">🙌 Praise</label></div>'+
    '<textarea id="fbMsg" maxlength="3000" placeholder="What worked, what didn\'t, what you\'d love next…" required></textarea>'+
    '<input id="fbEmail" type="email" autocomplete="email" placeholder="Email (optional, if you\'d like a reply)">'+
    '<div class="row"><span class="n">Also: <a href="mailto:bindig.dj@gmail.com" style="color:#78F09A">bindig.dj@gmail.com</a> · <a href="/privacy/" style="color:#78F09A">Privacy</a></span><button type="submit" class="go">&gt; Send</button></div>'+
    '<p class="st" id="fbSt" role="status" aria-live="polite"></p></form>';
  document.body.appendChild(d);
  var msg = d.querySelector("#fbMsg"), em = d.querySelector("#fbEmail"), stt = d.querySelector("#fbSt");
  function open(){ stt.textContent=""; stt.className="st"; if (d.showModal) d.showModal(); else d.setAttribute("open",""); setTimeout(function(){msg.focus();},30); }
  b.addEventListener("click", open);
  setInterval(function(){ var sb = document.getElementById("sticky"); b.style.bottom = (sb && !sb.hidden && sb.offsetParent !== null) ? (sb.offsetHeight + 16) + "px" : "16px"; }, 800);
  d.querySelector("#fbX").addEventListener("click", function(){ d.close(); });
  function ctx(){
    var c = { page: location.pathname };
    try { var on = document.querySelector("#stepbar .on"); if (on) c.step = on.textContent.trim(); } catch(e){}
    try { var tab = document.querySelector('#tabs button[aria-selected="true"]'); var pv = document.getElementById("paidView"); if (tab && pv && !pv.hidden) c.tab = tab.dataset.tab; } catch(e){}
    try { var ln = document.getElementById("libname"); if (ln && ln.textContent) { var m = ln.textContent.match(/([\d,]+) tracks/); if (m) c.tracks = +m[1].replace(/,/g,""); } } catch(e){}
    return c;
  }
  d.querySelector("form").addEventListener("submit", function(e){
    e.preventDefault();
    var text = msg.value.trim(); if (text.length < 3) { stt.textContent = "Write a few words first."; stt.className = "st err"; msg.focus(); return; }
    var type = (d.querySelector('input[name="fbType"]:checked')||{}).value || "idea";
    var v = ""; try { v = localStorage.getItem("bindig_visitor") || ""; } catch(e){}
    var go = d.querySelector(".go"); go.disabled = true; stt.textContent = "Sending…"; stt.className = "st";
    fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json", "x-bindig-visitor": v },
      body: JSON.stringify({ type: type, message: text, email: em.value.trim(), context: ctx() }) })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "Couldn't send."); return j; }); })
      .then(function(){ stt.textContent = "Thanks! Got it."; msg.value = ""; setTimeout(function(){ d.close(); }, 1200); })
      .catch(function(err){ stt.textContent = err.message + " You can also email bindig.dj@gmail.com."; stt.className = "st err"; })
      .finally(function(){ go.disabled = false; });
  });
})();
