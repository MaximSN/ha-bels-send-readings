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
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    }
    if (!this._initialized) {
      this._initialized = true;
      hass.callWS({ type: "bels/history" }).then(result => {
        this._entries = result.entries || [];
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

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const entries = this._entries || [];
    const lastStatus = entries[0]?.status || "unknown";
    const statusText = lastStatus === "success"
      ? "Последняя отправка: успешно"
      : lastStatus === "error"
        ? "Последняя отправка: ошибка"
        : "Пока нет отправок";
    this.shadowRoot.innerHTML = `
      <ha-card header="БЭЛС — передача показаний">
        <div class="content">
          <div class="status">${this._escape(this._loadError || statusText)}</div>
          <label for="reading-date">Дата показаний</label>
          <input id="reading-date" type="date" value="${this._escape(this._selectedDate)}">
          <div class="actions">
            <mwc-button raised id="send">Отправить показания</mwc-button>
            <mwc-button id="history">История отправок (${entries.length})</mwc-button>
          </div>
          <div id="details" ${this._historyVisible ? "" : "hidden"}></div>
        </div>
      </ha-card>
      <style>
        .content{padding:16px}.status{margin-bottom:14px}label{display:block;margin-bottom:6px;font-size:14px}
        input[type=date]{box-sizing:border-box;max-width:100%;padding:10px 12px;margin-bottom:16px;border:1px solid var(--outline-color,var(--divider-color));border-radius:6px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}
        .actions{display:flex;gap:8px;flex-wrap:wrap}
        #details{margin-top:16px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}
        td,th{text-align:left;padding:7px;border-bottom:1px solid var(--divider-color);vertical-align:top}
        .error{color:var(--error-color)}.success{color:var(--success-color)}
      </style>`;
    this.shadowRoot.getElementById("reading-date").addEventListener("change", event => {
      this._selectedDate = event.target.value || this._selectedDate;
    });
    this.shadowRoot.getElementById("send").addEventListener("click", async () => {
      const button = this.shadowRoot.getElementById("send");
      const dateInput = this.shadowRoot.getElementById("reading-date");
      if (!dateInput.value) {
        this._showMessage("Выберите дату показаний.");
        return;
      }
      this._selectedDate = dateInput.value;
      button.disabled = true;
      try {
        await this._hass.callService("bels", "submit_readings", {
          date: dateInput.value,
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
    return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }

  getCardSize() { return 3; }
}
customElements.define("bels-panel", BelsPanel);
window.customCards = window.customCards || [];
window.customCards.push({type:"bels-panel",name:"БЭЛС — передача показаний",description:"Отправка показаний и история"});
