class BelsPanel extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot) return;
    if (!this._selectedDate) {
      this._selectedDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"
      }).format(new Date());
    }
    if (!this._initialized) {
      this._initialized = true;
      hass.callWS({ type: "bels/history" }).then(result => {
        this._entries = result.entries || [];
        this._config = result.config || {};
        this._render();
      }).catch(error => {
        this._loadError = error.message;
        this._render();
      });
      hass.connection.subscribeEvents(event => {
        this._entries = event.data.entries || [];
        this._render();
      }, "bels_submission_finished").then(unsubscribe => {
        this._unsubscribe = unsubscribe;
      });
    }
    this._render();
  }

  disconnectedCallback() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._initialized = false;
  }

  _sensorValue(entityId) {
    if (!entityId || !this._hass.states[entityId]) return "";
    const value = Number(this._hass.states[entityId].state);
    if (!Number.isFinite(value)) return "";
    const roundTo = Number(this._config.round_to ?? 50);
    const rounded = roundTo > 0 ? Math.ceil(value / roundTo) * roundTo : value;
    return String(rounded);
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const entries = this._entries || [];
    const config = this._config || {};
    const entities = config.entities || {};
    const roundTo = Number(config.round_to ?? 0);
    const oldValue = id => this.shadowRoot.getElementById(id)?.value;
    const dateValue = oldValue("reading-date") || this._selectedDate;
    const dayValue = oldValue("reading-day") ?? this._sensorValue(entities.day);
    const nightValue = oldValue("reading-night") ?? this._sensorValue(entities.night);
    const peakValue = oldValue("reading-peak") ?? this._sensorValue(entities.peak);
    const lastStatus = entries[0]?.status;
    const statusText = lastStatus === "success" ? "Последняя отправка: успешно" :
      lastStatus === "error" ? "Последняя отправка: ошибка" : "";
    const account = this._escape(config.account || "—");
    const phone = this._escape(config.phone || "—");
    const email = this._escape(config.email || "—");
    const roundingHint = roundTo > 0
      ? "<div class='hint'>Показания округлены вверх до ближайшего кратного " + this._escape(roundTo) + "</div>"
      : "";
    this.shadowRoot.innerHTML = [
      "<ha-card header='БЭЛС — передача показаний'><div class='content'>",
      "<div class='subscriber'><div><span class='caption'>Лицевой счёт</span><strong>" + account + "</strong></div><div><span class='caption'>Телефон</span><strong>" + phone + "</strong></div><div><span class='caption'>E-mail</span><strong>" + email + "</strong></div></div>",
      this._loadError || statusText ? "<div class='status'>" + this._escape(this._loadError || statusText) + "</div>" : "",
      "<fieldset><legend>Показания</legend>",
      "<div class='reading-grid'>",
      "<div class='field'><label for='reading-date'>Дата <span class='required'>*</span></label><input id='reading-date' type='date' required value='" + this._escape(dateValue) + "'></div>",
      "<div class='field'><label for='reading-day'>Общие (день) <span class='required'>*</span></label><input id='reading-day' type='number' step='any' required value='" + this._escape(dayValue) + "'></div>",
      "<div class='field'><label for='reading-night'>Ночь</label><input id='reading-night' type='number' step='any' value='" + this._escape(nightValue) + "'></div>",
      "<div class='field'><label for='reading-peak'>Пик</label><input id='reading-peak' type='number' step='any' value='" + this._escape(peakValue) + "'></div>",
      "</div>" + roundingHint + "</fieldset>",
      "<div class='actions'><button id='send' class='primary'>Отправить показания</button><button id='history' class='secondary'>История отправок</button></div>",
      "<div id='details' " + (this._historyVisible ? "" : "hidden") + "></div></div></ha-card>",
      "<style>",
      ".content{padding:16px}.subscriber{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px;padding:12px;border:1px solid var(--divider-color);border-radius:8px}.subscriber>div{display:flex;flex-direction:column;gap:4px;min-width:0;overflow-wrap:anywhere}.caption{font-size:12px;color:var(--secondary-text-color)}.subscriber strong{font-size:14px;font-weight:500}.status{margin-bottom:14px;color:var(--secondary-text-color)}",
      "fieldset{border:1px solid var(--divider-color);border-radius:8px;padding:14px;margin:0 0 16px}legend{padding:0 6px;font-weight:600}.reading-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}.field{min-width:0;display:flex;flex-direction:column;gap:6px}label{font-size:14px}.required{color:var(--error-color)}",
      "input{box-sizing:border-box;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--outline-color,var(--divider-color));border-radius:6px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.hint{margin-top:12px;font-size:12px;color:var(--secondary-text-color)}",
      ".actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{appearance:none;border:1px solid var(--outline-color,var(--divider-color));border-radius:6px;padding:9px 14px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;background:var(--card-background-color);color:var(--primary-text-color)}.actions button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}.actions button:disabled{opacity:.6;cursor:default}#details{margin-top:16px;overflow:auto}",
      "table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px;border-bottom:1px solid var(--divider-color);vertical-align:top}.error{color:var(--error-color)}.success{color:var(--success-color)}",
      "@media(max-width:420px){.subscriber{grid-template-columns:1fr}.reading-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
      "</style>"
    ].join("");
    this.shadowRoot.getElementById("reading-date").addEventListener("change", event => {
      this._selectedDate = event.target.value || this._selectedDate;
    });
    this.shadowRoot.getElementById("send").addEventListener("click", async () => {
      const button = this.shadowRoot.getElementById("send");
      const dateInput = this.shadowRoot.getElementById("reading-date");
      const dayInput = this.shadowRoot.getElementById("reading-day");
      const nightInput = this.shadowRoot.getElementById("reading-night");
      const peakInput = this.shadowRoot.getElementById("reading-peak");
      const day = dayInput.value.trim();
      if (!dateInput.value) {
        this._showMessage("Выберите дату показаний.");
        return;
      }
      if (!day || !Number.isFinite(Number(day))) {
        this._showMessage("Укажите числовое значение «Общие (день)».");
        dayInput.focus();
        return;
      }
      for (const [label, input] of [["Ночь", nightInput], ["Пик", peakInput]]) {
        if (input.value.trim() && !Number.isFinite(Number(input.value))) {
          this._showMessage("Показание «" + label + "» должно быть числом.");
          input.focus();
          return;
        }
      }
      this._selectedDate = dateInput.value;
      button.disabled = true;
      try {
        await this._hass.callService("bels", "submit_readings", {
          date: dateInput.value,
          day,
          night: nightInput.value.trim(),
          peak: peakInput.value.trim(),
          screen_width: window.screen?.width || 0,
          screen_height: window.screen?.height || 0,
          viewport_width: window.innerWidth || 0,
          viewport_height: window.innerHeight || 0,
          local_locale: (navigator.language || "ru").split("-")[0]
        });
      } catch (e) {
        this._showMessage("Не удалось вызвать отправку: " + e.message);
      } finally {
        button.disabled = false;
      }
    });
    this.shadowRoot.getElementById("history").addEventListener("click", () => {
      this._historyVisible = !this._historyVisible;
      const target = this.shadowRoot.getElementById("details");
      target.hidden = !this._historyVisible;
      if (this._historyVisible) target.innerHTML = this._historyHtml(entries);
    });
    if (this._historyVisible) {
      this.shadowRoot.getElementById("details").innerHTML = this._historyHtml(entries);
    }
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
    return String(value).replace(/[&<>\"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }

  getCardSize() { return 5; }
}
customElements.define("bels-panel", BelsPanel);
window.customCards = window.customCards || [];
window.customCards.push({type:"bels-panel",name:"БЭЛС — передача показаний",description:"Отправка показаний и история"});
