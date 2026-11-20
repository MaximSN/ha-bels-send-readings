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
    if (this._initialized) return;
    this._initialized = true;
    this._readingFieldUpdatedAt = {};
    hass.connection.subscribeEvents(event => {
      this._handleStateChanged(event);
    }, "state_changed").then(unsubscribe => {
      if (this.isConnected) this._unsubscribeState = unsubscribe;
      else unsubscribe();
    });
    hass.callWS({ type: "bels/history" }).then(result => {
      this._entries = result.entries || [];
      this._config = result.config || {};
      this._configLoaded = true;
      this._render();
      this._initializeReadingTracking();
    }).catch(error => {
      this._loadError = error.message;
      this._render();
    });
    hass.connection.subscribeEvents(event => {
      this._entries = event.data.entries || [];
      if (this._historyVisible) {
        const target = this.shadowRoot.getElementById("details");
        if (target) {
          target.innerHTML = this._historyHtml(this._entries);
          this._bindHistoryActions(this._entries);
        }
      }
    }, "bels_submission_finished").then(unsubscribe => {
      if (this.isConnected) this._unsubscribe = unsubscribe;
      else unsubscribe();
    });
  }

  disconnectedCallback() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._unsubscribeState) {
      this._unsubscribeState();
      this._unsubscribeState = null;
    }
    this._initialized = false;
  }

  _sensorValue(entityId, rawValue) {
    if (!entityId) return "";
    const state = rawValue === undefined ? this._hass.states[entityId]?.state : rawValue;
    if (state === undefined || state === null) return "";
    const value = Number(state);
    if (!Number.isFinite(value)) return "";
    const roundTo = Number(this._config.round_to ?? 50);
    const rounded = roundTo > 0 ? Math.ceil(value / roundTo) * roundTo : value;
    return String(rounded);
  }

  _initializeReadingTracking() {
    const entities = this._config?.entities || {};
    const fields = { day: "reading-day", night: "reading-night", peak: "reading-peak" };
    const now = Date.now();
    for (const [key, id] of Object.entries(fields)) {
      const input = this.shadowRoot.getElementById(id);
      if (!input) continue;
      this._readingFieldUpdatedAt[key] = now;
      input.addEventListener("input", () => {
        this._readingFieldUpdatedAt[key] = Date.now();
      });
    }
  }

  _handleStateChanged(event) {
    const data = event?.data || {};
    const entityId = data.entity_id;
    const newState = data.new_state;
    if (!entityId || !newState || !this._configLoaded) return;
    const entities = this._config?.entities || {};
    const fields = {
      [entities.day]: ["day", "reading-day"],
      [entities.night]: ["night", "reading-night"],
      [entities.peak]: ["peak", "reading-peak"]
    };
    const field = fields[entityId];
    if (!field) return;
    const [key, inputId] = field;
    const lastChanged = new Date(newState.last_changed).getTime();
    const savedAt = this._readingFieldUpdatedAt?.[key] || 0;
    if (!Number.isFinite(lastChanged) || lastChanged <= savedAt) return;
    const input = this.shadowRoot.getElementById(inputId);
    if (!input) return;
    const nextValue = this._sensorValue(entityId, newState.state);
    if (input.value !== nextValue) input.value = nextValue;
    this._readingFieldUpdatedAt[key] = Date.now();
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const entries = this._entries || [];
    const config = this._config || {};
    const entities = config.entities || {};
    const roundTo = Number(config.round_to ?? 0);
    const oldValue = id => this.shadowRoot.getElementById(id)?.value;
    const preserveValues = this._configLoaded === true && this._formInitialized === true;
    const dateValue = preserveValues ? (oldValue("reading-date") || this._selectedDate) : this._selectedDate;
    const dayValue = preserveValues ? oldValue("reading-day") : this._sensorValue(entities.day);
    const nightValue = preserveValues ? oldValue("reading-night") : this._sensorValue(entities.night);
    const peakValue = preserveValues ? oldValue("reading-peak") : this._sensorValue(entities.peak);
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
      ".content{padding:16px}.subscriber{display:grid;grid-template-columns:max-content 11ch minmax(0,1fr);gap:12px;margin-bottom:16px;padding:12px;border:1px solid var(--divider-color);border-radius:8px}.subscriber>div{display:flex;flex-direction:column;gap:4px;min-width:0;overflow-wrap:anywhere}.subscriber>div:nth-child(2) strong{white-space:nowrap;overflow:hidden;text-overflow:clip}.caption{font-size:12px;color:var(--secondary-text-color)}.subscriber strong{font-size:14px;font-weight:500}.status{margin-bottom:14px;color:var(--secondary-text-color)}",
      "fieldset{border:1px solid var(--divider-color);border-radius:8px;padding:14px;margin:0 0 16px}legend{padding:0 6px;font-weight:600}.reading-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}.field{min-width:0;display:flex;flex-direction:column;gap:6px}label{font-size:14px}.required{color:var(--error-color)}",
      "input{box-sizing:border-box;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--outline-color,var(--divider-color));border-radius:6px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.hint{margin-top:12px;font-size:12px;color:var(--secondary-text-color)}",
      ".actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{appearance:none;border:1px solid var(--outline-color,var(--divider-color));border-radius:6px;padding:9px 14px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;background:var(--card-background-color);color:var(--primary-text-color)}.actions button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}.actions button:disabled{opacity:.6;cursor:default}#details{margin-top:16px;overflow:auto}",
      "table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px;border-bottom:1px solid var(--divider-color);vertical-align:top}.error{color:var(--error-color)}.success{color:var(--success-color)}.data-button,.data-window button{appearance:none;border:1px solid var(--outline-color,var(--divider-color));border-radius:6px;padding:6px 10px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit;cursor:pointer}.data-window{position:fixed;z-index:10;top:10%;right:5%;width:min(680px,90vw);max-height:80vh;display:flex;flex-direction:column;background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.28);padding:12px}.data-window-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:10px;cursor:move;user-select:none;touch-action:none}.data-window-header>div{display:flex;gap:8px}.data-window .close-data{font-size:20px;line-height:1;padding:4px 9px}.data-content{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;margin:0;padding:12px;background:var(--secondary-background-color);border-radius:6px;font-size:12px;}",
      "@media(max-width:420px){.subscriber{grid-template-columns:1fr}.reading-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
      "</style>"
    ].join("");
    if (this._configLoaded) this._formInitialized = true;
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
      if (this._historyVisible) { target.innerHTML = this._historyHtml(entries); this._bindHistoryActions(entries); }
    });
    if (this._historyVisible) {
      this.shadowRoot.getElementById("details").innerHTML = this._historyHtml(entries);
      this._bindHistoryActions(entries);
    }
  }

  _formatTimestamp(value) {
    const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    return match ? match[1] + " " + match[2] : String(value || "");
  }

  _historyHtml(entries) {
    if (!entries.length) return "<p>История пока пуста.</p>";
    return "<table><thead><tr><th>Дата</th><th>Источник</th><th>Статус</th><th>Комментарий</th><th>Данные</th></tr></thead><tbody>" +
      entries.map((item, index) => "<tr><td>" + this._escape(this._formatTimestamp(item.timestamp)) + "</td><td>" + this._escape(item.source_label || item.source || "") +
      "</td><td class='" + (item.status === "success" ? "success" : "error") + "'>" + this._escape(item.status_label || item.status || "") +
      "</td><td>" + this._escape(item.comment || "") + "</td><td><button class='data-button' data-index='" + index + "'>Показать</button></td></tr>").join("") +
      "</tbody></table>";
  }

  _bindHistoryActions(entries) {
    this.shadowRoot.querySelectorAll(".data-button").forEach(button => {
      button.addEventListener("click", () => this._openDataWindow(entries[Number(button.dataset.index)]));
    });
  }

  _openDataWindow(item) {
    this.shadowRoot.getElementById("data-window")?.remove();
    const data = JSON.stringify({
      form: item.form,
      response: item.response,
      http_status: item.http_status
    }, null, 2);
    const windowElement = document.createElement("section");
    windowElement.id = "data-window";
    windowElement.className = "data-window";
    windowElement.setAttribute("role", "region");
    windowElement.setAttribute("aria-label", "Данные отправки");
    windowElement.innerHTML = "<div class='data-window-header'><strong>Данные отправки</strong><div><button class='copy-data'>Скопировать</button><button class='close-data' aria-label='Закрыть'>×</button></div></div><pre class='data-content'></pre>";
    windowElement.querySelector(".data-content").textContent = data;
    const header = windowElement.querySelector(".data-window-header");
    header.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      const rect = windowElement.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      header.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const left = Math.max(0, Math.min(window.innerWidth - rect.width, moveEvent.clientX - offsetX));
        const top = Math.max(0, Math.min(window.innerHeight - 48, moveEvent.clientY - offsetY));
        windowElement.style.left = left + "px";
        windowElement.style.top = top + "px";
        windowElement.style.right = "auto";
      };
      const stop = () => {
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", stop);
        header.removeEventListener("pointercancel", stop);
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", stop);
      header.addEventListener("pointercancel", stop);
    });
    windowElement.querySelector(".close-data").addEventListener("click", () => windowElement.remove());
    windowElement.querySelector(".copy-data").addEventListener("click", async event => {
      const button = event.currentTarget;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(data);
        } else {
          const area = document.createElement("textarea");
          area.value = data;
          windowElement.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        button.textContent = "Скопировано";
      } catch (error) {
        button.textContent = "Не удалось скопировать";
      }
    });
    this.shadowRoot.appendChild(windowElement);
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
