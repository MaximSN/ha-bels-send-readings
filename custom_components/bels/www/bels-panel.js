class BelsPanel extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot) return;
    const history = hass.states["sensor.bels_история_отправок"] || Object.values(hass.states).find(s => s.attributes.friendly_name === "История отправок");
    const last = Object.values(hass.states).find(s => s.attributes.friendly_name === "Последняя отправка");
    const entries = history?.attributes?.entries || [];
    const lastStatus = last?.state || "unknown";
    this.shadowRoot.innerHTML = `
      <ha-card header="БЭЛС — передача показаний">
        <div class="content">
          <div class="status">${this._escape(lastStatus === "success" ? "Последняя отправка: успешно" : lastStatus === "error" ? "Последняя отправка: ошибка" : "Пока нет отправок")}</div>
          <div class="actions">
            <mwc-button raised id="send">Отправить показания</mwc-button>
            <mwc-button id="history">История отправок (${entries.length})</mwc-button>
          </div>
          <div id="details" hidden></div>
        </div>
      </ha-card>
      <style>
        .content{padding:16px}.status{margin-bottom:14px}.actions{display:flex;gap:8px;flex-wrap:wrap}
        #details{margin-top:16px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}
        td,th{text-align:left;padding:7px;border-bottom:1px solid var(--divider-color);vertical-align:top}
        .error{color:var(--error-color)}.success{color:var(--success-color)}
      </style>`;
    this.shadowRoot.getElementById("send").addEventListener("click", async () => {
      const button = this.shadowRoot.getElementById("send");
      button.disabled = true;
      try {
        await hass.callService("bels", "submit_readings");
      } catch (e) {
        this._showMessage("Не удалось вызвать отправку: " + e.message);
      } finally {
        button.disabled = false;
      }
    });
    this.shadowRoot.getElementById("history").addEventListener("click", () => {
      const target = this.shadowRoot.getElementById("details");
      target.hidden = !target.hidden;
      target.innerHTML = this._historyHtml(entries);
    });
  }

  _historyHtml(entries) {
    if (!entries.length) return "<p>История пока пуста.</p>";
    return "<table><thead><tr><th>Дата</th><th>Источник</th><th>Статус</th><th>Комментарий</th><th>Данные</th></tr></thead><tbody>" +
      entries.map(item => "<tr><td>" + this._escape(item.timestamp || "") + "</td><td>" + this._escape(item.source_label || item.source || "") +
      "</td><td class='" + (item.status === "success" ? "success" : "error") + "'>" + this._escape(item.status_label || item.status || "") +
      "</td><td>" + this._escape(item.comment || "") + "</td><td><details><summary>Показать</summary><pre>" +
      this._escape(JSON.stringify({form:item.form,response:item.response,http_status:item.http_status}, null, 2)) +
      "</pre></details></td></tr>").join("") + "</tbody></table>";
  }

  _showMessage(message) {
    const target = this.shadowRoot.getElementById("details");
    target.hidden = false;
    target.textContent = message;
  }

  _escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }

  getCardSize() { return 3; }
}
customElements.define("bels-panel", BelsPanel);
window.customCards = window.customCards || [];
window.customCards.push({type:"bels-panel",name:"БЭЛС — передача показаний",description:"Отправка показаний и история"});
