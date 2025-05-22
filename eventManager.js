const modalTitle = document.getElementById("modal-title");
const eventListContainer = document.getElementById("event-list-container");
const singleEventForm = document.getElementById("single-event-form");
const eventNameInputModal = document.getElementById("event-name-modal");
const eventNameValidationMessage = document.getElementById("event-name-validation");
const eventStartDateInputModal = document.getElementById("event-start-date-modal");
const eventEndDateInputModal = document.getElementById("event-end-date-modal");
const eventStartTimeInputModal = document.getElementById("event-start-time-modal");
const eventEndTimeInputModal = document.getElementById("event-end-time-modal");
const eventDescriptionEditor = document.getElementById("event-description-editor");
const eventDescriptionToolbar = document.getElementById("event-description-toolbar");
const eventColorInputModal = document.getElementById("event-color-modal");
const eventLocationInputModal = document.getElementById("event-location-modal");

let editingEventId = null;
let currentDayForModal = null;

const localStorageKey = "germanCalendarEvents_v2";
let customEvents = [];

function saveEvents() {
  try {
    localStorage.setItem(localStorageKey, JSON.stringify(customEvents));
  } catch (e) {
    console.error("Error saving events to localStorage:", e);
  }
}

function loadEvents() {
  try {
    const savedEvents = localStorage.getItem(localStorageKey);
    if (savedEvents) {
      customEvents = JSON.parse(savedEvents);
      if (!Array.isArray(customEvents)) customEvents = [];
    } else {
      customEvents = [];
    }
  } catch (e) {
    console.error("Error loading events from localStorage:", e);
    customEvents = [];
  }
}
window.loadEvents = loadEvents;

function _setModalView(viewType) {
  const isList = viewType === "list";
  singleEventForm.style.display = isList ? "none" : "block";
  document.getElementById("add-new-event-button").style.display = isList ? "block" : "none";
}

function getEventsForDate(dateString) {
  const appDisplayTimezone = luxon.DateTime.local().zoneName;
  const clickedDayStart = luxon.DateTime.fromISO(dateString, { zone: appDisplayTimezone }).startOf("day");
  const clickedDayEnd = luxon.DateTime.fromISO(dateString, { zone: appDisplayTimezone }).endOf("day");
  const clickedDayIntervalUtc = luxon.Interval.fromDateTimes(clickedDayStart.toUTC(), clickedDayEnd.toUTC());

  return customEvents.filter((event) => {
    if (!event || !event.start || !event.end) return false;
    if (event.start_utc && event.end_utc) {
      try {
        const eventStartUtc = luxon.DateTime.fromISO(event.start_utc, { zone: "utc" });
        const eventEndUtc = luxon.DateTime.fromISO(event.end_utc, { zone: "utc" });
        if (!eventStartUtc.isValid || !eventEndUtc.isValid) return false;
        const eventIntervalUtc = luxon.Interval.fromDateTimes(eventStartUtc, eventEndUtc);
        return clickedDayIntervalUtc.overlaps(eventIntervalUtc);
      } catch (e) {
        console.warn("Error in getEventsForDate (timed)", event, e);
        return false;
      }
    } else {
      // All-day event
      try {
        const eventStartDate = luxon.DateTime.fromISO(event.start, { zone: appDisplayTimezone }).startOf("day");
        const eventEndDate = luxon.DateTime.fromISO(event.end, { zone: appDisplayTimezone }).startOf("day");
        if (!eventStartDate.isValid || !eventEndDate.isValid) return false;
        return clickedDayStart >= eventStartDate && clickedDayStart <= eventEndDate;
      } catch (e) {
        console.warn("Error in getEventsForDate (all-day)", event, e);
        return false;
      }
    }
  });
}
window.getEventsForDate = getEventsForDate;

function handleDayClick(event) {
  let clickedElement = event.target.closest(".day:not(.empty-day)[data-date], .week-day-header[data-date], .week-all-day-slot[data-date], .hour-slot[data-date]");
  if (clickedElement && clickedElement.dataset.date) {
    openModal("list", clickedElement.dataset.date);
  }
}
window.handleDayClick = handleDayClick;

function initializeEventForm(eventData = null) {
  const browserDefaultZone = luxon.DateTime.local().zoneName;
  const startTzSelect = document.getElementById("event-start-timezone-modal");
  const endTzSelect = document.getElementById("event-end-timezone-modal");

  if (eventData) {
    eventNameInputModal.value = eventData.name || "";
    eventDescriptionEditor.innerHTML = eventData.description ? HtmlUtils.sanitizeHtml(eventData.description) : "";
    eventColorInputModal.value = eventData.color || "#3b82f6";
    eventLocationInputModal.value = eventData.location || "";
    document.getElementById("event-all-day-modal").checked = !eventData.start_utc;

    if (eventData.start_utc) {
      const displayStartTimezone = eventData.startTimezone || browserDefaultZone;
      const startDt = luxon.DateTime.fromISO(eventData.start_utc, { zone: "utc" }).setZone(displayStartTimezone);
      eventStartDateInputModal.value = startDt.toFormat("yyyy-MM-dd");
      eventStartTimeInputModal.value = startDt.toFormat("HH:mm");
      if (startTzSelect) startTzSelect.value = displayStartTimezone;

      const displayEndTimezone = eventData.endTimezone || browserDefaultZone;
      const endDt = luxon.DateTime.fromISO(eventData.end_utc, { zone: "utc" }).setZone(displayEndTimezone);
      eventEndDateInputModal.value = endDt.toFormat("yyyy-MM-dd");
      eventEndTimeInputModal.value = endDt.toFormat("HH:mm");
      if (endTzSelect) endTzSelect.value = displayEndTimezone;
    } else {
      eventStartDateInputModal.value = eventData.start || currentDayForModal || luxon.DateTime.now().toFormat("yyyy-MM-dd");
      eventEndDateInputModal.value = eventData.end || eventStartDateInputModal.value;
      eventStartTimeInputModal.value = "";
      eventEndTimeInputModal.value = "";
      if (startTzSelect) startTzSelect.value = browserDefaultZone;
      if (endTzSelect) endTzSelect.value = browserDefaultZone;
    }
  } else {
    eventNameInputModal.value = "";
    eventDescriptionEditor.innerHTML = "";
    eventColorInputModal.value = "#3b82f6";
    eventLocationInputModal.value = "";
    document.getElementById("event-all-day-modal").checked = true;
    const defaultDate = currentDayForModal || luxon.DateTime.now().toFormat("yyyy-MM-dd");
    eventStartDateInputModal.value = defaultDate;
    eventEndDateInputModal.value = defaultDate;
    eventStartTimeInputModal.value = "";
    eventEndTimeInputModal.value = "";
    if (startTzSelect) startTzSelect.value = browserDefaultZone;
    if (endTzSelect) endTzSelect.value = browserDefaultZone;
  }
  const isAllDay = document.getElementById("event-all-day-modal").checked;
  document.querySelectorAll(".event-time-input, .event-timezone-select").forEach((el) => (el.style.display = isAllDay ? "none" : "block"));
  eventNameValidationMessage.textContent = "";
  document.getElementById("delete-event-button").style.display = eventData ? "inline-block" : "none";
  editingEventId = eventData?.id || null;
}

function renderEventListModal(date) {
  modalTitle.textContent = `Ereignisse am ${DateUtils.formatForDisplay(date)}`;
  _setModalView("list");
  const appDisplayTimezone = luxon.DateTime.local().zoneName;
  const eventsForDay = getEventsForDate(date);
  const eventListEl = document.getElementById("event-list");
  eventListEl.innerHTML = "";
  if (eventsForDay.length > 0) {
    eventListContainer.style.display = "block";
    eventsForDay.sort((a, b) => (a.start_utc ? luxon.DateTime.fromISO(a.start_utc).toMillis() : luxon.DateTime.fromISO(a.start, { zone: appDisplayTimezone }).startOf("day").toMillis()) - (b.start_utc ? luxon.DateTime.fromISO(b.start_utc).toMillis() : luxon.DateTime.fromISO(b.start, { zone: appDisplayTimezone }).startOf("day").toMillis()));
    const fragment = document.createDocumentFragment();
    eventsForDay.forEach((event) => {
      const listItem = document.createElement("li");
      listItem.dataset.eventId = event.id;
      const isAllDayEvent = !event.start_utc;
      const formattedDateTime = DateUtils.formatDateTimeRange(event, isAllDayEvent, appDisplayTimezone);
      const eventNameDisplay = event.name ? DateUtils.escapeIcsField(event.name) : "Unbenanntes Ereignis";
      let descriptionHtml = "";
      if (event.description) {
        descriptionHtml = HtmlUtils.sanitizeHtml(event.description);
      }
      let locationDisplayHtml = "";
      if (event.location) {
        locationDisplayHtml = `<span class="event-list-location">📍 ${HtmlUtils.sanitizeHtml(event.location)}</span>`;
      }
      listItem.innerHTML = `
        <span class="event-color-dot" style="background-color: ${event.color || "#3b82f6"};"></span>
        <div class="event-details">
          <strong>${eventNameDisplay}</strong>
          <span>${formattedDateTime}</span>
          ${locationDisplayHtml}
        </div>`;
      fragment.appendChild(listItem);
    });
    eventListEl.appendChild(fragment);
  } else eventListContainer.style.display = "none";
}

function renderEventFormModal(eventId = null) {
  _setModalView("form");
  eventListContainer.style.display = "none";
  if (eventId) {
    modalTitle.textContent = "Ereignis bearbeiten";
    const eventToEdit = customEvents.find((event) => event.id === eventId);
    if (eventToEdit) initializeEventForm(eventToEdit);
    else {
      console.error("Event to edit not found:", eventId);
      initializeEventForm(null);
    }
  } else {
    modalTitle.textContent = "Neues Ereignis hinzufügen";
    initializeEventForm(null);
  }
}

function openModal(view, data = null) {
  document.getElementById("event-modal-overlay").classList.add("visible");
  if (view === "list") {
    currentDayForModal = data;
    renderEventListModal(data);
  } else if (view === "form") renderEventFormModal(data);
}
window.openModal = openModal;

function closeEventModal() {
  document.getElementById("event-modal-overlay").classList.remove("visible");
  editingEventId = null;
  currentDayForModal = null;
  eventNameValidationMessage.textContent = "";
}
window.closeEventModal = closeEventModal;

function addOrUpdateCustomEvent() {
  const name = eventNameInputModal.value.trim();
  const startDateString = eventStartDateInputModal.value;
  let endDateString = eventEndDateInputModal.value;
  const description = eventDescriptionEditor.innerHTML;
  const location = eventLocationInputModal.value.trim();
  const color = eventColorInputModal.value;
  const isAllDay = document.getElementById("event-all-day-modal").checked;
  let startTimeString = eventStartTimeInputModal.value;
  let endTimeString = eventEndTimeInputModal.value;
  const selectedStartTimezone = document.getElementById("event-start-timezone-modal")?.value || luxon.DateTime.local().zoneName;
  const selectedEndTimezone = document.getElementById("event-end-timezone-modal")?.value || luxon.DateTime.local().zoneName;

  eventNameValidationMessage.textContent = "";
  if (!name) {
    eventNameValidationMessage.textContent = "Bitte Namen eingeben.";
    eventNameInputModal.focus();
    return;
  }
  if (!startDateString) {
    alert("Startdatum eingeben.");
    eventStartDateInputModal.focus();
    return;
  }
  if (!endDateString) endDateString = startDateString;

  const eventEntry = {
    id: editingEventId || luxon.DateTime.now().toMillis().toString() + Math.random().toString(16).slice(2),
    name,
    description,
    location,
    color,
    start: startDateString,
    end: endDateString,
  };

  if (isAllDay) {
    delete eventEntry.time;
    delete eventEntry.endTime;
    delete eventEntry.start_utc;
    delete eventEntry.end_utc;
    delete eventEntry.startTimezone;
    delete eventEntry.endTimezone;
    if (luxon.DateTime.fromISO(startDateString) > luxon.DateTime.fromISO(endDateString)) {
      alert("Startdatum darf nicht nach dem Enddatum liegen für ganztägige Ereignisse.");
      eventEndDateInputModal.focus();
      return;
    }
  } else {
    if (!startTimeString) startTimeString = "00:00";
    const startDtCheck = luxon.DateTime.fromISO(startDateString + "T" + startTimeString);
    let endDtCheck = luxon.DateTime.fromISO(endDateString + "T" + (endTimeString || startTimeString));

    if (!endTimeString || (startDateString === endDateString && endDtCheck <= startDtCheck)) {
      const tempStartDt = luxon.DateTime.fromISO(startDateString + "T" + startTimeString, { zone: selectedStartTimezone });
      const tempEndDt = tempStartDt.plus({ hours: 1 });
      endDateString = tempEndDt.toFormat("yyyy-MM-dd");
      endTimeString = tempEndDt.toFormat("HH:mm");
      eventEndDateInputModal.value = endDateString;
      eventEndTimeInputModal.value = endTimeString;
    }

    eventEntry.time = startTimeString;
    eventEntry.endTime = endTimeString;
    eventEntry.startTimezone = selectedStartTimezone;
    eventEntry.endTimezone = selectedEndTimezone;

    const [sY, sM, sD] = startDateString.split("-").map(Number);
    const [sH, sMin] = startTimeString.split(":").map(Number);
    let startDt = luxon.DateTime.fromObject({ year: sY, month: sM, day: sD, hour: sH, minute: sMin }, { zone: selectedStartTimezone });

    const [eY, eM, eD] = endDateString.split("-").map(Number);
    const [eH, eMin] = endTimeString.split(":").map(Number);
    let endDt = luxon.DateTime.fromObject({ year: eY, month: eM, day: eD, hour: eH, minute: eMin }, { zone: selectedEndTimezone });

    if (!startDt.isValid) {
      alert(`Ungültiges Startdatum/-zeit: ${startDt.invalidReason || "Unbekannter Grund"}`);
      return;
    }
    if (!endDt.isValid) {
      alert(`Ungültiges Enddatum/-zeit: ${endDt.invalidReason || "Unbekannter Grund"}`);
      return;
    }
    if (startDt >= endDt) {
      alert("Der Startzeitpunkt muss vor dem Endzeitpunkt liegen.");
      return;
    }
    eventEntry.start_utc = startDt.toUTC().toISO();
    eventEntry.end_utc = endDt.toUTC().toISO();
  }

  if (!Array.isArray(customEvents)) customEvents = [];
  if (editingEventId) {
    const idx = customEvents.findIndex((e) => e.id === editingEventId);
    if (idx !== -1) customEvents[idx] = eventEntry;
    else {
      customEvents.push(eventEntry);
    }
  } else {
    customEvents.push(eventEntry);
  }
  saveEvents();
  if (typeof updateCalendar === "function") updateCalendar();
  closeEventModal();
}
window.addOrUpdateCustomEvent = addOrUpdateCustomEvent;

function deleteEvent() {
  if (editingEventId && confirm("Sind Sie sicher, dass Sie dieses Ereignis löschen möchten?")) {
    customEvents = customEvents.filter((event) => event.id !== editingEventId);
    saveEvents();
    if (typeof updateCalendar === "function") updateCalendar();
    closeEventModal();
  }
}
window.deleteEvent = deleteEvent;

function formatDoc(command, value = null) {
  if (eventDescriptionEditor && document.queryCommandSupported(command)) {
    eventDescriptionEditor.focus();
    document.execCommand(command, false, value);
    eventDescriptionEditor.focus();
  } else if (eventDescriptionEditor) {
    console.warn(`Command "${command}" is not supported by the browser or editor not found.`);
  }
}

if (eventDescriptionToolbar) {
  eventDescriptionToolbar.addEventListener("click", function (event) {
    const button = event.target.closest(".toolbar-button");
    if (!button) return;
    const command = button.dataset.command;
    if (command) {
      if (command === "createLink") {
        const url = prompt("Link URL eingeben:", "https://");
        if (url) {
          formatDoc(command, url);
        }
      } else {
        formatDoc(command);
      }
    }
  });
}

function importEvents(eventImport) {
  const file = eventImport.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const ics = e.target.result;
      if (!ics) {
        alert("Die Datei ist leer oder konnte nicht gelesen werden.");
        return;
      }
      const imported = [];
      const icsEvents = ics.split("BEGIN:VEVENT");

      for (let idx = 1; idx < icsEvents.length; idx++) {
        let veventTextChunk = icsEvents[idx];
        if (idx === icsEvents.length - 1 && !veventTextChunk.toUpperCase().includes("END:VEVENT")) {
          const endVcalIndex = veventTextChunk.toUpperCase().indexOf("END:VCALENDAR");
          if (endVcalIndex !== -1) {
            veventTextChunk = veventTextChunk.substring(0, endVcalIndex) + "END:VEVENT\r\n" + veventTextChunk.substring(endVcalIndex);
          } else {
            veventTextChunk += "\r\nEND:VEVENT";
          }
        } else if (!veventTextChunk.toUpperCase().includes("END:VEVENT")) {
          const nextBegin = veventTextChunk.toUpperCase().indexOf("BEGIN:");
          if (nextBegin !== -1) {
            veventTextChunk = veventTextChunk.substring(0, nextBegin) + "END:VEVENT\r\n" + veventTextChunk.substring(nextBegin);
          } else {
            veventTextChunk += "\r\nEND:VEVENT";
          }
        }

        const eventContentBeforeEnd = veventTextChunk.split(/END:VEVENT/i)[0];
        const rawLinesFromChunk = ("BEGIN:VEVENT\r\n" + eventContentBeforeEnd).split(/\r\n|\n|\r/);

        const unfoldedLines = [];
        let currentPropertyBuffer = "";
        for (const rawLine of rawLinesFromChunk) {
          if (rawLine.length === 0 && !currentPropertyBuffer) continue;
          if (rawLine.startsWith(" ") || rawLine.startsWith("\t")) {
            if (currentPropertyBuffer) {
              currentPropertyBuffer += rawLine.substring(1);
            }
          } else {
            if (currentPropertyBuffer) {
              unfoldedLines.push(currentPropertyBuffer);
            }
            currentPropertyBuffer = rawLine;
          }
        }
        if (currentPropertyBuffer) {
          unfoldedLines.push(currentPropertyBuffer);
        }

        let veventSummary, veventDescription;
        let dtstartLine, dtendLine, color, uid, rrule, veventLocation;
        let inAlarmBlock = false;

        unfoldedLines.forEach((line) => {
          if (line.startsWith("BEGIN:VALARM")) {
            inAlarmBlock = true;
            return;
          }
          if (line.startsWith("END:VALARM")) {
            inAlarmBlock = false;
            return;
          }
          if (inAlarmBlock) return;

          const colonIndex = line.indexOf(":");
          if (colonIndex === -1) return;

          const propNameWithParams = line.substring(0, colonIndex);
          const propValue = line.substring(colonIndex + 1);
          const mainPropName = propNameWithParams.split(";")[0].toUpperCase();

          switch (mainPropName) {
            case "SUMMARY":
              veventSummary = propValue;
              break;
            case "DESCRIPTION":
              veventDescription = propValue;
              break;
            case "DTSTART":
              dtstartLine = line;
              break;
            case "DTEND":
              dtendLine = line;
              break;
            case "X-APPLE-CALENDAR-COLOR":
              color = propValue;
              break;
            case "UID":
              uid = propValue;
              break;
            case "RRULE":
              rrule = propValue;
              break;
            case "LOCATION":
              veventLocation = propValue;
              break;
          }
        });

        if (!dtstartLine) {
          console.warn("VEVENT skipped: Missing DTSTART.");
          continue;
        }
        const parsedStart = DateUtils.parseIcsDateTime(dtstartLine);
        if (!parsedStart.luxonUtcDateTime || !parsedStart.luxonUtcDateTime.isValid) {
          console.warn("VEVENT skipped: Invalid DTSTART.", dtstartLine);
          continue;
        }
        let parsedEnd = dtendLine ? DateUtils.parseIcsDateTime(dtendLine) : null;

        let finalDescription = DateUtils.unescapeIcsField(veventDescription || "");
        const separatorPattern = "\n\n-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:"; // Actual newlines after unescaping
        const separatorIndex = finalDescription.indexOf(separatorPattern);

        if (separatorIndex !== -1) {
          finalDescription = finalDescription.substring(0, separatorIndex);
        }

        const appEvent = {
          id: DateUtils.unescapeIcsField(uid || luxon.DateTime.now().toMillis() + Math.random().toString(16)),
          name: DateUtils.unescapeIcsField(veventSummary) || "Unbenanntes Ereignis",
          description: finalDescription.trim(),
          location: DateUtils.unescapeIcsField(veventLocation || "").trim(),
          color: color || "#3b82f6",
        };

        if (parsedStart.isAllDay) {
          appEvent.start = parsedStart.luxonUtcDateTime.toFormat("yyyy-MM-dd");
          if (parsedEnd?.luxonUtcDateTime?.isValid && parsedEnd.isAllDay) {
            appEvent.end = parsedEnd.luxonUtcDateTime.minus({ days: 1 }).toFormat("yyyy-MM-dd");
          } else {
            appEvent.end = appEvent.start;
          }
          if (luxon.DateTime.fromISO(appEvent.end) < luxon.DateTime.fromISO(appEvent.start)) {
            appEvent.end = appEvent.start;
          }
        } else {
          appEvent.start_utc = parsedStart.luxonUtcDateTime.toISO();
          appEvent.startTimezone = parsedStart.originalTzid || luxon.DateTime.local().zoneName;
          const startInOriginalZone = parsedStart.luxonUtcDateTime.setZone(appEvent.startTimezone);
          appEvent.start = startInOriginalZone.toFormat("yyyy-MM-dd");
          appEvent.time = startInOriginalZone.toFormat("HH:mm");

          if (parsedEnd?.luxonUtcDateTime?.isValid && !parsedEnd.isAllDay) {
            appEvent.end_utc = parsedEnd.luxonUtcDateTime.toISO();
            appEvent.endTimezone = parsedEnd.originalTzid || appEvent.startTimezone;
            const endInOriginalZone = parsedEnd.luxonUtcDateTime.setZone(appEvent.endTimezone);
            appEvent.end = endInOriginalZone.toFormat("yyyy-MM-dd");
            appEvent.endTime = endInOriginalZone.toFormat("HH:mm");
          } else {
            const defaultEndUtc = parsedStart.luxonUtcDateTime.plus({ hours: 1 });
            appEvent.end_utc = defaultEndUtc.toISO();
            appEvent.endTimezone = appEvent.startTimezone;
            const endInOriginalZone = defaultEndUtc.setZone(appEvent.endTimezone);
            appEvent.end = endInOriginalZone.toFormat("yyyy-MM-dd");
            appEvent.endTime = endInOriginalZone.toFormat("HH:mm");
          }
        }
        if (rrule) appEvent.rrule = rrule;
        imported.push(appEvent);
      }

      if (imported.length > 0) {
        const merge = confirm(`Möchten Sie ${imported.length} Ereignisse importieren? OK = Zusammenführen, Abbrechen = Ersetzen`);
        if (!Array.isArray(customEvents)) customEvents = [];
        if (merge) {
          imported.forEach((impEvent) => {
            const existingIndex = customEvents.findIndex((e) => e.id === impEvent.id);
            if (existingIndex > -1) customEvents[existingIndex] = impEvent;
            else customEvents.push(impEvent);
          });
        } else {
          customEvents = imported;
        }
        saveEvents();
        if (typeof updateCalendar === "function") updateCalendar();
        alert(`${imported.length} Ereignis(se) importiert/aktualisiert.`);
      } else {
        alert("Keine gültigen VEVENT-Einträge in der Datei gefunden.");
      }
    } catch (err) {
      console.error("Fehler bei der Verarbeitung der ICS-Datei:", err);
      alert("Fehler bei der Verarbeitung der ICS-Datei.");
    } finally {
      eventImport.target.value = "";
    }
  };
  reader.onerror = (err) => {
    console.error("Fehler beim Lesen der Datei:", err);
    alert("Fehler beim Lesen der Datei.");
    eventImport.target.value = "";
  };
  reader.readAsText(file);
}
window.importEvents = importEvents;

function exportEvents() {
  const events = Array.isArray(customEvents) ? customEvents : [];
  if (events.length === 0) {
    alert("Keine Ereignisse zum Exportieren vorhanden.");
    return;
  }
  const escape = DateUtils.escapeIcsField;
  let icsString = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GermanYearPlanner//DE v1.0//EN\r\nCALSCALE:GREGORIAN\r\n`;
  const dtStamp = luxon.DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

  events.forEach((event) => {
    if (!event || !event.start || !event.end || typeof event.name !== "string") {
      console.warn("Ungültiges Ereignis beim Export übersprungen (fehlende Basisdaten):", event);
      return;
    }
    icsString += `BEGIN:VEVENT\r\n`;
    icsString += `UID:${event.id || luxon.DateTime.now().toMillis() + Math.random().toString(16)}\r\n`;
    icsString += `DTSTAMP:${dtStamp}\r\n`;
    icsString += `SUMMARY:${escape(event.name || "")}\r\n`;
    if (event.description) icsString += `DESCRIPTION:${escape(event.description)}\r\n`;
    if (event.color) icsString += `X-APPLE-CALENDAR-COLOR:${event.color}\r\n`;
    if (event.location) icsString += `LOCATION:${escape(event.location)}\r\n`;
    if (event.rrule) icsString += `RRULE:${event.rrule}\r\n`;

    if (event.start_utc && event.end_utc) {
      const startUtcLuxon = luxon.DateTime.fromISO(event.start_utc, { zone: "utc" });
      const endUtcLuxon = luxon.DateTime.fromISO(event.end_utc, { zone: "utc" });
      const startTZID = event.startTimezone && event.startTimezone !== "UTC" && luxon.IANAZone.isValidZone(event.startTimezone) ? event.startTimezone : null;
      const endTZID = event.endTimezone && event.endTimezone !== "UTC" && luxon.IANAZone.isValidZone(event.endTimezone) ? event.endTimezone : null;

      icsString += `DTSTART${startTZID ? `;TZID=${startTZID}` : ""}:${DateUtils.formatIcsDateTime(startUtcLuxon, false, startTZID)}\r\n`;
      icsString += `DTEND${endTZID ? `;TZID=${endTZID}` : ""}:${DateUtils.formatIcsDateTime(endUtcLuxon, false, endTZID)}\r\n`;
    } else {
      const startDt = luxon.DateTime.fromISO(event.start);
      const endDtIcs = luxon.DateTime.fromISO(event.end).plus({ days: 1 });
      icsString += `DTSTART;${DateUtils.formatIcsDateTime(startDt, true)}\r\n`;
      icsString += `DTEND;${DateUtils.formatIcsDateTime(endDtIcs, true)}\r\n`;
    }
    icsString += `END:VEVENT\r\n`;
  });
  icsString += `END:VCALENDAR\r\n`;

  const blob = new Blob([icsString], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `kalender_export_${luxon.DateTime.now().toFormat("yyyy-MM-dd")}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
window.exportEvents = exportEvents;
