/*
 * Intense Care — website enquiry widget.
 *
 * Add to any page of the company website:
 *
 *   <div data-intense-enquiry
 *        data-endpoint="https://YOUR-ERP-DOMAIN/api/public/enquiry"
 *        data-ads-send-to="AW-XXXXXXXXX/abcDEF123"   (optional: Google Ads conversion)
 *   ></div>
 *   <script src="https://YOUR-ERP-DOMAIN/enquiry-widget.js" defer></script>
 *
 * The website's origin must be listed in LEAD_FORM_ALLOWED_ORIGINS on the ERP.
 * UTM tags and the Google Ads click id (gclid) of the visit are kept for the
 * browser session (first touch) and sent with the enquiry. Nothing else is tracked.
 */
(function () {
  "use strict";
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
  var STORE = "ic_enquiry_attr";

  function attribution() {
    var saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(STORE) || "{}"); } catch (e) { saved = {}; }
    var p = new URLSearchParams(location.search);
    var fresh = {};
    KEYS.forEach(function (k) { var v = p.get(k); if (v) fresh[k] = v.slice(0, 300); });
    if (!saved.landingPage) {
      saved.landingPage = location.href.slice(0, 500);
      if (document.referrer) saved.referrer = document.referrer.slice(0, 500);
    }
    // First touch wins within a session; a new campaign click replaces it.
    if (Object.keys(fresh).length) KEYS.forEach(function (k) { saved[k] = fresh[k]; });
    try { sessionStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {}
    return saved;
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }

  function field(form, label, name, type, required, extra) {
    var id = "ic-" + name + "-" + Math.random().toString(36).slice(2, 7);
    var wrap = el("div", { style: "margin:0 0 12px" });
    wrap.appendChild(el("label", { for: id, style: "display:block;font:600 14px system-ui;margin:0 0 4px;color:#18181b" }, label + (required ? " *" : "")));
    var input = el(type === "textarea" ? "textarea" : "input", Object.assign({ id: id, name: name, style: "box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid #d4d4d8;border-radius:12px;font:16px system-ui" }, type === "textarea" ? { rows: "3" } : { type: type }, extra || {}));
    if (required) input.required = true;
    wrap.appendChild(input);
    form.appendChild(wrap);
  }

  function mount(host) {
    var endpoint = host.getAttribute("data-endpoint");
    if (!endpoint) return;
    var started = Date.now();
    var form = el("form", { novalidate: "" });
    field(form, "Your name", "name", "text", true, { maxlength: "120", autocomplete: "name" });
    field(form, "Phone", "phone", "tel", true, { maxlength: "24", autocomplete: "tel", inputmode: "tel" });
    field(form, "Email", "email", "email", false, { maxlength: "160", autocomplete: "email" });
    field(form, "Service needed", "service", "text", false, { maxlength: "200" });
    field(form, "Area / address", "location", "text", false, { maxlength: "300" });
    field(form, "PIN code", "postalCode", "text", false, { maxlength: "16", inputmode: "numeric" });
    field(form, "Preferred date", "preferredDate", "date", false);
    field(form, "Message", "message", "textarea", false, { maxlength: "2000" });
    // Honeypot — invisible to people.
    var hp = el("input", { name: "company_website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true", style: "position:absolute;left:-9999px;width:1px;height:1px;opacity:0" });
    form.appendChild(hp);
    var status = el("p", { role: "status", style: "font:14px system-ui;margin:8px 0 0" });
    var btn = el("button", { type: "submit", style: "width:100%;min-height:48px;border:0;border-radius:12px;background:#ea506c;color:#fff;font:600 16px system-ui;cursor:pointer" }, "Send enquiry");
    form.appendChild(btn);
    form.appendChild(status);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = String(v); });
      if (!data.name || !data.phone) { status.style.color = "#b91c1c"; status.textContent = "Please enter your name and phone."; return; }
      var attr = attribution();
      Object.keys(attr).forEach(function (k) { data[k] = attr[k]; });
      data.startedAt = started;
      btn.disabled = true;
      btn.textContent = "Sending…";
      fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j && res.j.success) {
            form.replaceWith(el("p", { role: "status", style: "font:16px system-ui;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:12px" }, res.j.message || "Thank you!"));
            var sendTo = host.getAttribute("data-ads-send-to");
            if (sendTo && typeof window.gtag === "function") window.gtag("event", "conversion", { send_to: sendTo });
          } else {
            status.style.color = "#b91c1c";
            status.textContent = (res.j && res.j.error) || "Couldn't send. Please call us.";
            btn.disabled = false;
            btn.textContent = "Send enquiry";
          }
        })
        .catch(function () {
          status.style.color = "#b91c1c";
          status.textContent = "You're offline. Please try again.";
          btn.disabled = false;
          btn.textContent = "Send enquiry";
        });
    });
    host.appendChild(form);
  }

  function init() {
    attribution();
    Array.prototype.forEach.call(document.querySelectorAll("[data-intense-enquiry]"), mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
