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
      if (event.data.item?.source === "manual") this._showSubmissionResult(event.data.item);
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
    this._formInitialized = false;
  }

  _sensorValue(entityId, rawValue) {
    if (!entityId) return "";
    const state = rawValue === undefined ? this._hass.states[entityId]?.state : rawValue;
    if (state === undefined || state === null) return "";
    const value = Number(state);
    if (!Number.isFinite(value)) return "";
    const roundTo = this._config.round_to == null ? null : Number(this._config.round_to);
    const rounded = roundTo > 0 ? Math.ceil(value / roundTo) * roundTo : value;
    return String(rounded);
  }

  _initializeReadingTracking() {
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
    const roundTo = config.round_to == null ? null : Number(config.round_to);
    const oldValue = id => this.shadowRoot.getElementById(id)?.value;
    const preserveValues = this._configLoaded === true && this._formInitialized === true;
    const dateValue = preserveValues ? (oldValue("reading-date") || this._selectedDate) : this._selectedDate;
    const dayValue = preserveValues ? oldValue("reading-day") : this._sensorValue(entities.day);
    const nightValue = preserveValues ? oldValue("reading-night") : this._sensorValue(entities.night);
    const peakValue = preserveValues ? oldValue("reading-peak") : this._sensorValue(entities.peak);
    const account = this._escape(config.account || "—");
    const phone = this._escape(config.phone || "—");
    const email = this._escape(config.email || "—");
    const autoDay = Number(config.auto_day);
    const scheduleDay = Number.isFinite(autoDay) ? (autoDay === 31 ? "последний день месяца" : this._escape(autoDay) + " число месяца") : "не задан";
    const autoSendHint = "<div class='auto-send-hint'><div>Автоматическая отправка показаний: " +
      (config.auto_enabled === true ? "Включена" : config.auto_enabled === false ? "Выключена" : "Не настроена") +
      "</div><div>Расписание: " + scheduleDay + " в " + this._escape(config.auto_time || "не задано") + "</div></div>";
    const roundingHint = roundTo != null && roundTo > 0
      ? "<div class='hint'>Показания округлены вверх до ближайшего кратного " + this._escape(roundTo) + "</div>"
      : "";
    this.shadowRoot.innerHTML = [
      "<ha-card header='БЭЛС — передача показаний'><div class='content'>",
      autoSendHint,
      "<div class='subscriber'><div><span class='caption'>Лицевой счёт</span><strong>" + account + "</strong></div><div><span class='caption'>Телефон</span><strong>" + phone + "</strong></div><div><span class='caption'>E-mail</span><strong>" + email + "</strong></div></div>",
      this._loadError ? "<div class='status'>" + this._escape(this._loadError) + "</div>" : "",
      "<fieldset><legend>Показания</legend>",
      "<div class='reading-grid'>",
      "<div class='field'><label for='reading-date'>Дата <span class='required'>*</span></label><input id='reading-date' type='date' required value='" + this._escape(dateValue) + "'></div>",
      "<div class='field'><label for='reading-day'>День <span class='required'>*</span></label><input id='reading-day' type='number' step='any' required value='" + this._escape(dayValue) + "'></div>",
      "<div class='field'><label for='reading-night'>Ночь</label><input id='reading-night' type='number' step='any' value='" + this._escape(nightValue) + "'></div>",
      "<div class='field'><label for='reading-peak'>Пик</label><input id='reading-peak' type='number' step='any' value='" + this._escape(peakValue) + "'></div>",
      "</div>" + roundingHint + "</fieldset>",
      "<div class='actions'><button id='send' class='primary'>Отправить показания</button><button id='history' class='secondary'>История отправок</button></div>",
      "<div id='details' " + (this._historyVisible ? "" : "hidden") + "></div></div></ha-card>",
      "<style>",
      "ha-card{--ha-card-header-padding:8px 16px 0}.content{padding:0 var(--ha-card-padding,16px) var(--ha-card-padding,16px)}.auto-send-hint{margin:0 0 8px;font-size:13px;line-height:1.25;color:var(--primary-text-color)}.subscriber{display:grid;grid-template-columns:max-content max-content minmax(0,1fr);gap:0;margin-bottom:16px;padding:12px;border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,8px)}.subscriber>div{display:flex;flex-direction:column;gap:4px;min-width:0;overflow-wrap:anywhere;padding:0 12px}.subscriber>div:first-child{padding-left:0}.subscriber>div+div{border-left:1px solid var(--divider-color)}.caption{font-size:12px;color:var(--secondary-text-color)}.subscriber strong{font-size:14px;font-weight:500;white-space:nowrap}.status{margin-bottom:14px;color:var(--secondary-text-color)}",
      "fieldset{border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,8px);padding:14px;margin:0 0 16px}legend{padding:0 6px;font-weight:600}.reading-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}.field{min-width:0;display:flex;flex-direction:column;gap:6px}label{font-size:14px}.required{color:var(--error-color)}",
      "input{box-sizing:border-box;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--input-fill-color,var(--divider-color));border-radius:var(--ha-textfield-border-radius,6px);background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.hint{margin-top:12px;font-size:12px;color:var(--secondary-text-color)}",
      ".actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{appearance:none;border:1px solid var(--primary-color);border-radius:var(--ha-button-border-radius,var(--ha-card-border-radius,6px));padding:9px 14px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;background:var(--primary-color);color:var(--text-primary-color)}.actions button:disabled{opacity:.6;cursor:default}#details{margin-top:16px;overflow:auto}",
      "table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:5px 4px;border-bottom:1px solid var(--divider-color);vertical-align:top;overflow-wrap:anywhere}th:nth-child(1){width:26%}th:nth-child(2){width:12%}th:nth-child(3){width:9%}th:nth-child(5){width:40px}.history-date{white-space:nowrap}.history-mode{white-space:nowrap}.history-filter-toolbar{display:flex;justify-content:flex-end;align-items:center;margin:0 0 6px}.history-filter-toggle,.history-status-filter button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:2px;border:1px solid var(--divider-color);border-radius:6px;background:var(--secondary-background-color);color:var(--primary-text-color);cursor:pointer}.history-filter-toggle ha-icon{--mdc-icon-size:18px}.history-filter-panel{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:0 0 8px;padding:8px;border:1px solid var(--divider-color);border-radius:6px}.history-filter-panel[hidden]{display:none}.history-status-filter{display:flex;gap:4px;align-items:center}.history-status-filter button[aria-pressed='true']{border-color:var(--primary-color)}.history-status-filter ha-icon{--mdc-icon-size:18px}.history-date-filter{width:150px;max-width:100%;min-width:0}.error{color:var(--error-color)}.success{color:var(--success-color)}.data-button,.data-window button{appearance:none;border:1px solid var(--divider-color);border-radius:var(--ha-button-border-radius,6px);padding:4px 7px;background:var(--secondary-background-color);color:var(--primary-text-color);font:inherit;cursor:pointer}.data-button{width:28px;height:28px;padding:3px;display:inline-flex;align-items:center;justify-content:center}.data-button ha-icon{--mdc-icon-size:18px}.data-window{position:fixed;z-index:10;top:10%;right:5%;width:min(680px,90vw);max-height:80vh;display:flex;flex-direction:column;background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,10px);box-shadow:var(--ha-card-box-shadow);padding:12px}.data-window-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:10px;cursor:move;user-select:none;touch-action:none}.data-window-header>div{display:flex;gap:8px}.data-window .close-data{font-size:20px;line-height:1;padding:4px 9px}.data-summary{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:0 0 12px;padding:8px 10px;border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,8px)}.data-summary-col{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:7px;row-gap:5px;min-width:0;padding:0 10px}.data-summary-col:first-child{padding-left:0}.data-summary-col+ .data-summary-col{border-left:1px solid var(--divider-color)}.data-summary-row{display:contents}.data-summary-label{font-size:11px;color:var(--secondary-text-color);white-space:nowrap}.data-summary-value{min-width:0;font-size:13px;overflow-wrap:anywhere}.data-content{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;margin:0;padding:12px;background:var(--secondary-background-color);border-radius:var(--ha-card-border-radius,6px);font-size:12px}.submission-overlay{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--ha-dialog-scrim-background)}.submission-dialog{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,calc(100% - 40px));padding:20px;background-color:var(--card-background-color,#fff);color:var(--primary-text-color);opacity:1;backdrop-filter:none;border-radius:var(--ha-card-border-radius,12px);box-shadow:var(--ha-card-box-shadow,0 8px 28px rgba(0,0,0,.32))}.submission-dialog-header{margin:0 0 12px;cursor:grab;user-select:none;touch-action:none}.submission-dialog-header:active{cursor:grabbing}.submission-dialog-header h3{margin:0}.submission-dialog h3{margin:0 0 12px}.submission-dialog p{margin:0 0 16px;white-space:pre-wrap}.submission-dialog button{border:0;border-radius:var(--ha-button-border-radius,6px);padding:9px 16px;background:var(--primary-color);color:var(--text-primary-color,var(--text-on-primary-color,#fff));font:inherit;cursor:pointer}.submission-dialog button:disabled{opacity:.6;cursor:default}.submission-dialog .success{color:var(--success-color)}.submission-dialog .error{color:var(--error-color)}.confirm-table{width:100%;border-collapse:collapse;margin:0 0 16px}.confirm-table th,.confirm-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--divider-color);overflow-wrap:anywhere}.confirm-table th{width:42%;font-weight:500;color:var(--secondary-text-color)}.confirm-actions{display:flex;justify-content:flex-end;gap:8px}.submission-dialog .cancel-confirm{background:var(--secondary-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color)}",
      "@media(max-width:420px){.subscriber{grid-template-columns:1fr}.subscriber>div{padding:8px 0}.subscriber>div+div{border-left:0;border-top:1px solid var(--divider-color)}.data-summary{grid-template-columns:1fr}.data-summary-col{padding:8px 0}.data-summary-col+ .data-summary-col{border-left:0;border-top:1px solid var(--divider-color)}}",
      "</style>"
    ].join("");
    if (this._configLoaded) this._formInitialized = true;
    this.shadowRoot.getElementById("reading-date").addEventListener("change", event => {
      this._selectedDate = event.target.value || this._selectedDate;
    });
    this.shadowRoot.getElementById("send").addEventListener("click", () => {
      const dateInput = this.shadowRoot.getElementById("reading-date");
      const dayInput = this.shadowRoot.getElementById("reading-day");
      const nightInput = this.shadowRoot.getElementById("reading-night");
      const peakInput = this.shadowRoot.getElementById("reading-peak");
      const day = dayInput.value.trim();
      const night = nightInput.value.trim();
      const peak = peakInput.value.trim();
      if (!dateInput.value) {
        this._showMessage("Выберите дату показаний.");
        return;
      }
      if (!day || !Number.isFinite(Number(day))) {
        this._showMessage("Укажите числовое значение «День».");
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
      this._showSubmissionConfirm({
        date: dateInput.value,
        account: this._config.account || "—",
        phone: this._config.phone || "",
        email: this._config.email || "",
        day,
        night,
        peak
      });
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

  _filteredHistoryEntries(entries) {
    return entries.filter(item => {
      const date = this._formatTimestamp(item.timestamp).slice(0, 10);
      const dateMatches = !this._historyDateFilter || date.slice(0, 7) === this._historyDateFilter;
      const statusMatches = !this._historyStatusFilter || item.status === this._historyStatusFilter;
      return dateMatches && statusMatches;
    });
  }

  _historyHtml(entries) {
    if (!entries.length) return "<p>История пока пуста.</p>";
    const filtered = this._filteredHistoryEntries(entries);
    const rows = filtered.map((item, index) => {
      let details = item.comment || "";
      if (item.status === "success") {
        const formData = item.form?.data || {};
        const readings = [
          ["д", formData["pattern-pokazaniya-obshchie-den"]],
          ["н", formData["pattern-pokazaniya-noch"]],
          ["п", formData["pattern-pokazaniya-pik"]]
        ].filter(([, value]) => value !== undefined && value !== null && value !== "");
        details = readings.map(([label, value]) => label + ": " + value).join(", ");
      }
      return "<tr><td class='history-date'>" + this._escape(this._formatTimestamp(item.timestamp)) + "</td><td>" + this._escape(item.source === "manual" ? "Ручной" : "Авто") +
        "</td><td class='" + (item.status === "success" ? "success" : "error") + "'><ha-icon icon='" + (item.status === "success" ? "mdi:check-circle" : "mdi:close-circle") + "' title='" + (item.status === "success" ? "Успешно" : "Ошибка") + "'></ha-icon></td>" +
        "<td>" + this._escape(details) + "</td><td><button class='data-button' data-index='" + index + "' title='Показать raw' aria-label='Показать raw'><ha-icon icon='mdi:file-code-outline'></ha-icon></button></td></tr>";
    }).join("");
    return "<div class='history-filter-toolbar'><button type='button' class='history-filter-toggle' aria-label='Показать фильтры' title='Фильтры' aria-expanded='" + (!!this._historyFiltersVisible) + "'><ha-icon icon='mdi:filter-variant'></ha-icon></button></div>" +
      "<div class='history-filter-panel' " + (this._historyFiltersVisible ? "" : "hidden") + "><input class='history-date-filter' type='month' aria-label='Фильтр по месяцу' value='" + this._escape(this._historyDateFilter || "") + "'>" +
      "<div class='history-status-filter' role='group' aria-label='Фильтр по статусу'><button type='button' data-status='' aria-label='Все статусы' aria-pressed='" + (!this._historyStatusFilter) + "'><ha-icon icon='mdi:filter-variant'></ha-icon></button><button type='button' data-status='success' aria-label='Успешно' aria-pressed='" + (this._historyStatusFilter === "success") + "'><ha-icon icon='mdi:check-circle' class='success'></ha-icon></button><button type='button' data-status='error' aria-label='Ошибка' aria-pressed='" + (this._historyStatusFilter === "error") + "'><ha-icon icon='mdi:close-circle' class='error'></ha-icon></button></div></div>" +
      "<table><thead><tr><th>Дата</th><th>Режим</th><th>Статус</th><th>Показания</th><th>raw</th></tr></thead><tbody>" + (rows || "<tr><td colspan='5'>Нет записей по выбранным фильтрам.</td></tr>") + "</tbody></table>";
  }

  _bindHistoryActions(entries) {
    const target = this.shadowRoot.getElementById("details");
    target.querySelector(".history-filter-toggle")?.addEventListener("click", event => {
      this._historyFiltersVisible = !this._historyFiltersVisible;
      const panel = target.querySelector(".history-filter-panel");
      if (panel) panel.hidden = !this._historyFiltersVisible;
      event.currentTarget.setAttribute("aria-expanded", String(this._historyFiltersVisible));
    });
    target.querySelector(".history-date-filter")?.addEventListener("change", event => {
      this._historyDateFilter = event.target.value;
      this._refreshHistory(entries);
    });
    target.querySelectorAll(".history-status-filter button").forEach(button => {
      button.addEventListener("click", () => {
        this._historyStatusFilter = button.dataset.status;
        this._refreshHistory(entries);
      });
    });
    const filtered = this._filteredHistoryEntries(entries);
    target.querySelectorAll(".data-button").forEach(button => {
      button.addEventListener("click", () => this._openDataWindow(filtered[Number(button.dataset.index)]));
    });
  }

  _refreshHistory(entries) {
    const target = this.shadowRoot.getElementById("details");
    if (!target) return;
    target.innerHTML = this._historyHtml(entries);
    this._bindHistoryActions(entries);
  }

  _openDataWindow(item) {
    this.shadowRoot.getElementById("data-window")?.remove();
    const data = JSON.stringify({
      form: item.form,
      response: item.response,
      http_status: item.http_status
    }, null, 2);
    const formData = item.form?.data || {};
    const readings = [
      ["День", formData["pattern-pokazaniya-obshchie-den"]],
      ["Ночь", formData["pattern-pokazaniya-noch"]],
      ["Пик", formData["pattern-pokazaniya-pik"]]
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const summaryRow = (label, value) => "<div class='data-summary-row'><span class='data-summary-label'>" + this._escape(label) + "</span><span class='data-summary-value'>" + this._escape(value || "—") + "</span></div>";
    const summary = "<div class='data-summary'><div class='data-summary-col'>" +
      summaryRow("Лицевой счёт", formData["pattern-licevoy-schet"]) +
      summaryRow("E-mail", formData["email-emayl"]) +
      summaryRow("Телефон", formData["phone-telefon"]) +
      summaryRow("Статус отправки", item.status === "success" ? "Успешно" : "Ошибка") +
      "</div><div class='data-summary-col'>" +
      summaryRow("Дата", formData["date-data"]) +
      readings.map(([label, value]) => summaryRow(label, value)).join("") +
      "</div></div>";
    const windowElement = document.createElement("section");
    windowElement.id = "data-window";
    windowElement.className = "data-window";
    windowElement.setAttribute("role", "region");
    windowElement.setAttribute("aria-label", "Данные отправки");
    windowElement.innerHTML = "<div class='data-window-header'><strong>Данные отправки</strong><div><button class='copy-data'>Скопировать</button><button class='close-data' aria-label='Закрыть'>×</button></div></div>" + summary + "<pre class='data-content'></pre>";
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
      } catch (error) {
        this._showMessage("Не удалось скопировать JSON: " + error.message);
      }
    });
    this.shadowRoot.appendChild(windowElement);
  }

  _showMessage(message) {
    const target = this.shadowRoot.getElementById("details");
    target.hidden = false;
    target.textContent = message;
  }

  _showSubmissionConfirm(values) {
    this.shadowRoot.getElementById("submission-confirm-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "submission-confirm-overlay";
    overlay.className = "submission-overlay";
    const rows = [
      ["Дата", values.date],
      ["Лицевой счёт", values.account],
      ["Телефон", values.phone || "—"],
      ["e-mail", values.email || "—"],
      ["День", values.day],
      ...(values.night ? [["Ночь", values.night]] : []),
      ...(values.peak ? [["Пик", values.peak]] : [])
    ];
    overlay.innerHTML = "<section class='submission-dialog' role='dialog' aria-modal='true' aria-labelledby='submission-confirm-title'>" +
      "<div class='submission-dialog-header'><h3 id='submission-confirm-title'>Подтвердите отправку показаний</h3></div>" +
      "<table class='confirm-table'><tbody>" + rows.map(([label, value]) =>
        "<tr><th>" + this._escape(label) + "</th><td>" + this._escape(value) + "</td></tr>"
      ).join("") + "</tbody></table>" +
      "<div class='confirm-actions'><button type='button' class='cancel-confirm'>Отмена</button><button type='button' class='accept-confirm'>Отправить</button></div>" +
      "</section>";
    const dialog = overlay.querySelector(".submission-dialog");
    const header = overlay.querySelector(".submission-dialog-header");
    header.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const rect = dialog.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      header.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const left = Math.max(0, Math.min(window.innerWidth - rect.width, moveEvent.clientX - offsetX));
        const top = Math.max(0, Math.min(window.innerHeight - rect.height, moveEvent.clientY - offsetY));
        dialog.style.left = left + "px";
        dialog.style.top = top + "px";
        dialog.style.transform = "none";
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
    overlay.querySelector(".cancel-confirm").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", event => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector(".accept-confirm").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await this._hass.callService("bels", "submit_readings", {
          date: values.date,
          day: values.day,
          night: values.night,
          peak: values.peak,
          screen_width: window.screen?.width || 0,
          screen_height: window.screen?.height || 0,
          viewport_width: window.innerWidth || 0,
          viewport_height: window.innerHeight || 0,
          local_locale: (navigator.language || "ru").split("-")[0]
        });
        overlay.remove();
      } catch (error) {
        button.disabled = false;
        this._showMessage("Не удалось вызвать отправку: " + error.message);
        overlay.remove();
      }
    });
    this.shadowRoot.appendChild(overlay);
  }

  _showSubmissionResult(item) {
    this.shadowRoot.getElementById("submission-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "submission-overlay";
    overlay.className = "submission-overlay";
    overlay.innerHTML = "<section class='submission-dialog' role='dialog' aria-modal='true' aria-labelledby='submission-title'>" +
      "<h3 id='submission-title'>Результат отправки</h3><p class='" + (item.status === "success" ? "success" : "error") + "'>" +
      this._escape(item.status === "success" ? "Показания отправлены." : (item.comment || "Не удалось отправить показания.")) +
      "</p><button type='button'>Закрыть</button></section>";
    overlay.querySelector("button").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", event => { if (event.target === overlay) overlay.remove(); });
    this.shadowRoot.appendChild(overlay);
  }

  _escape(value) {
    return String(value).replace(/[&<>\"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }

  getCardSize() { return 5; }
}
customElements.define("bels-panel", BelsPanel);
window.customCards = window.customCards || [];
window.customCards.push({type:"bels-panel",name:"БЭЛС — передача показаний",description:"Отправка показаний и история"});
