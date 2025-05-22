const yearSelect = document.getElementById("year-select");
const stateSelect = document.getElementById("state-select");
const viewSelect = document.getElementById("view-select");
const prevButton = document.getElementById("prev-button");
const nextButton = document.getElementById("next-button");
const importEventsButton = document.getElementById("import-events-button");
const importFileInput = document.getElementById("import-file-input");
const exportEventsButton = document.getElementById("export-events-button");
const eventListUL = document.getElementById("event-list");
const addNewEventButton = document.getElementById("add-new-event-button");
const eventAllDayCheckboxModal = document.getElementById("event-all-day-modal");
const saveEventButton = document.getElementById("save-event-button");
const deleteEventButton = document.getElementById("delete-event-button");
const modalCloseButton = document.getElementById("modal-close-button");
const eventModalOverlay = document.getElementById("event-modal-overlay");
const clearAllDataButton = document.getElementById("clear-all-data-button");

const eventStartTimezoneSelectModal = document.getElementById("event-start-timezone-modal");
const eventEndTimezoneSelectModal = document.getElementById("event-end-timezone-modal");

function populateYearsDropdown() {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 10;
  const endYear = currentYear + 10;
  const fragment = document.createDocumentFragment();
  for (let year = startYear; year <= endYear; year++) {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    if (year === currentYear) option.selected = true;
    fragment.appendChild(option);
  }
  yearSelect.appendChild(fragment);
}

function populateStatesDropdown() {
  const germanStates = {
    BW: "Baden-Württemberg",
    BY: "Bayern",
    BE: "Berlin",
    BB: "Brandenburg",
    HB: "Bremen",
    HH: "Hamburg",
    HE: "Hessen",
    MV: "Mecklenburg-Vorpommern",
    NI: "Niedersachsen",
    NW: "Nordrhein-Westfalen",
    RP: "Rheinland-Pfalz",
    SL: "Saarland",
    SN: "Sachsen",
    ST: "Sachsen-Anhalt",
    SH: "Schleswig-Holstein",
    TH: "Thüringen",
  };
  const fragment = document.createDocumentFragment();
  for (const code in germanStates) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = germanStates[code];
    if (code === "NW") option.selected = true;
    fragment.appendChild(option);
  }
  stateSelect.appendChild(fragment);
}

function getCommonIANATimezones() {
  let timezones = [];
  if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
    try {
      timezones = Intl.supportedValuesOf("timeZone");
    } catch (e) {
      console.warn("Intl.supportedValuesOf('timeZone') threw an error, using fallback list.", e);
      timezones = []; // Fallback to empty if error
    }
  }
  if (timezones.length === 0) {
    // If Intl failed or returned empty
    timezones = ["UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Moscow", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "America/Honolulu", "Pacific/Auckland", "Australia/Sydney", "Australia/Perth", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai", "Africa/Cairo", "Africa/Nairobi"];
  }
  return timezones.filter((tz) => tz && (tz === "UTC" || tz.includes("/"))).sort();
}

function populateTimezoneDropdown(selectElement) {
  if (!selectElement) return;
  const commonTimezones = getCommonIANATimezones();
  const browserZone = luxon.DateTime.local().zoneName;
  selectElement.innerHTML = "";
  const fragment = document.createDocumentFragment();
  commonTimezones.forEach((tz) => {
    const option = document.createElement("option");
    option.value = tz;
    option.textContent = tz.replace(/_/g, " ");
    if (tz === browserZone) option.selected = true;
    fragment.appendChild(option);
  });
  selectElement.appendChild(fragment);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function handleClearAllData() {
  if (confirm("Sind Sie sicher, dass Sie ALLE gespeicherten Ereignisse und Kalenderdaten löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.")) {
    if (typeof customEvents !== "undefined") {
      customEvents.length = 0;
    }
    if (typeof saveEvents === "function") {
      saveEvents();
    } else {
      localStorage.removeItem("germanCalendarEvents_v2"); // Ensure this key matches eventManager.js
    }
    console.log("Alle benutzerdefinierten Ereignisse gelöscht.");

    if (typeof window.clearCalendarGeometryCache === "function") {
      window.clearCalendarGeometryCache(true);
      console.log("Kalender-Geometrie-Cache gelöscht.");
    }

    if (typeof updateCalendar === "function") {
      updateCalendar(true);
      console.log("Kalenderansicht wird aktualisiert.");
      alert("Alle Kalenderdaten wurden erfolgreich gelöscht.");
    } else {
      console.error("updateCalendar function not found. Bitte laden Sie die Seite manuell neu.");
      alert("Daten gelöscht. Bitte laden Sie die Seite manuell neu, um die Änderungen zu sehen.");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof loadEvents === "function") loadEvents();
  else console.error("loadEvents function not found.");

  populateYearsDropdown();
  populateStatesDropdown();

  if (eventStartTimezoneSelectModal) populateTimezoneDropdown(eventStartTimezoneSelectModal);
  if (eventEndTimezoneSelectModal) populateTimezoneDropdown(eventEndTimezoneSelectModal);

  if (typeof window.setInitialCalendarState === "function") {
    window.setInitialCalendarState(parseInt(yearSelect.value), new Date().getMonth(), new Date().getDate(), viewSelect.value);
  } else console.error("setInitialCalendarState function not found on window.");

  yearSelect.addEventListener("change", () => updateCalendar(true));
  stateSelect.addEventListener("change", () => updateCalendar(true));
  viewSelect.addEventListener("change", () => updateCalendar(true));
  prevButton.addEventListener("click", () => navigate(-1));
  nextButton.addEventListener("click", () => navigate(1));

  eventAllDayCheckboxModal.addEventListener("change", (e) => {
    const showTimeRelated = !e.target.checked;
    document.querySelectorAll(".event-time-input, .event-timezone-select").forEach((el) => (el.style.display = showTimeRelated ? "block" : "none"));
    if (!showTimeRelated) {
      document.getElementById("event-start-time-modal").value = "";
      document.getElementById("event-end-time-modal").value = "";
    }
  });

  saveEventButton.addEventListener("click", addOrUpdateCustomEvent);
  deleteEventButton.addEventListener("click", deleteEvent);
  modalCloseButton.addEventListener("click", closeEventModal);
  eventModalOverlay.addEventListener("click", (event) => {
    if (event.target === eventModalOverlay) closeEventModal();
  });
  eventListUL.addEventListener("click", (event) => {
    const clickedItem = event.target.closest("li[data-event-id]");
    if (clickedItem) openModal("form", clickedItem.dataset.eventId);
  });
  exportEventsButton.addEventListener("click", exportEvents);
  importEventsButton.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", importEvents);
  addNewEventButton.addEventListener("click", () => openModal("form", null));

  if (clearAllDataButton) {
    clearAllDataButton.addEventListener("click", handleClearAllData);
  }

  const handleResize = debounce(() => {
    if (typeof window.clearCalendarGeometryCache === "function") window.clearCalendarGeometryCache();
    if (typeof updateCalendar === "function") updateCalendar(true);
    else console.error("updateCalendar function not found for resize handling.");
  }, 250);
  window.addEventListener("resize", handleResize);

  if (typeof updateCalendar === "function") updateCalendar(true);
  else console.error("updateCalendar function not found for initial render.");
});
