// Luxon is assumed to be globally available `luxon`

const DateUtils = {
  formatForDisplay: function (dateInput) {
    if (!dateInput) return "";
    try {
      let dt;
      if (typeof dateInput === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
          dt = luxon.DateTime.fromISO(dateInput);
        } else {
          dt = luxon.DateTime.fromJSDate(new Date(dateInput));
        }
      } else if (dateInput instanceof Date) {
        dt = luxon.DateTime.fromJSDate(dateInput);
      } else if (dateInput instanceof luxon.DateTime) {
        dt = dateInput;
      }

      if (!dt || !dt.isValid) {
        console.warn("DateUtils.formatForDisplay: Invalid dateInput or could not parse", dateInput);
        return String(dateInput);
      }
      return dt.toFormat("dd.MM.yyyy");
    } catch (e) {
      console.warn("DateUtils.formatForDisplay error:", e, "Input:", dateInput);
      return String(dateInput);
    }
  },

  formatTime: function (timeInput) {
    if (!timeInput && timeInput !== 0) return "";
    if (typeof timeInput === "string") {
      if (/^\d{2}:\d{2}$/.test(timeInput)) return timeInput;
    }
    if (timeInput instanceof luxon.DateTime && timeInput.isValid) {
      return timeInput.toFormat("HH:mm");
    }
    return "";
  },

  formatDateTimeRange: function (event, isAllDayExplicit, targetDisplayZone) {
    if (!event || !event.start || !event.end || !targetDisplayZone) {
      return "Ungültiger Eingabebereich";
    }
    try {
      let startDtInDisplayZone, endDtInDisplayZone;
      let startTimeDisplay = "",
        endTimeDisplay = "";
      const isAllDay = isAllDayExplicit !== undefined ? isAllDayExplicit : !event.start_utc;

      if (isAllDay) {
        startDtInDisplayZone = luxon.DateTime.fromISO(event.start, { zone: targetDisplayZone }).startOf("day");
        endDtInDisplayZone = luxon.DateTime.fromISO(event.end, { zone: targetDisplayZone }).startOf("day");
      } else {
        if (!event.start_utc || !event.end_utc) {
          console.warn("formatDateTimeRange: Timed event missing UTC dates", event);
          return "Ungültige Zeitdaten";
        }
        const effectiveStartZone = event.startTimezone || targetDisplayZone;
        const effectiveEndZone = event.endTimezone || targetDisplayZone;
        startDtInDisplayZone = luxon.DateTime.fromISO(event.start_utc, { zone: "utc" }).setZone(targetDisplayZone);
        endDtInDisplayZone = luxon.DateTime.fromISO(event.end_utc, { zone: "utc" }).setZone(targetDisplayZone);
        const originalStartDtInItsZone = luxon.DateTime.fromISO(event.start_utc, { zone: "utc" }).setZone(effectiveStartZone);
        startTimeDisplay = originalStartDtInItsZone.toFormat("HH:mm");
        const originalEndDtInItsZone = luxon.DateTime.fromISO(event.end_utc, { zone: "utc" }).setZone(effectiveEndZone);
        endTimeDisplay = originalEndDtInItsZone.toFormat("HH:mm");
      }

      if (!startDtInDisplayZone.isValid || !endDtInDisplayZone.isValid) {
        return "Ungültige Datumsobjekte";
      }

      let dateRangeStr;
      const startFormattedDate = startDtInDisplayZone.toFormat("dd.MM.yyyy");
      const endFormattedDate = endDtInDisplayZone.toFormat("dd.MM.yyyy");

      if (startDtInDisplayZone.hasSame(endDtInDisplayZone, "day")) {
        dateRangeStr = startFormattedDate;
      } else if (startDtInDisplayZone.hasSame(endDtInDisplayZone, "month") && startDtInDisplayZone.hasSame(endDtInDisplayZone, "year")) {
        dateRangeStr = `${startDtInDisplayZone.toFormat("dd.")} - ${endFormattedDate}`;
      } else if (startDtInDisplayZone.hasSame(endDtInDisplayZone, "year")) {
        dateRangeStr = `${startDtInDisplayZone.toFormat("dd.MM.")} - ${endFormattedDate}`;
      } else {
        dateRangeStr = `${startFormattedDate} - ${endFormattedDate}`;
      }

      let timeRangeStr = "";
      if (!isAllDay) {
        if (startTimeDisplay && endTimeDisplay) {
          timeRangeStr = `${startTimeDisplay} - ${endTimeDisplay}`;
        } else if (startTimeDisplay) {
          timeRangeStr = `ab ${startTimeDisplay}`;
        }
      }
      return timeRangeStr ? `${dateRangeStr}, ${timeRangeStr}` : dateRangeStr;
    } catch (e) {
      console.error("Error in DateUtils.formatDateTimeRange:", e, event);
      return "Fehler beim Formatieren";
    }
  },

  parseIcsDateTime: function (icsFullLine) {
    const colonIndex = icsFullLine.indexOf(":");
    if (colonIndex === -1) {
      return { luxonUtcDateTime: null, isAllDay: true, originalTzid: null };
    }
    const propAndParams = icsFullLine.substring(0, colonIndex);
    const value = icsFullLine.substring(colonIndex + 1);
    let isExplicitlyAllDay = propAndParams.includes("VALUE=DATE");
    let tzid = null;
    const tzidMatch = propAndParams.match(/TZID=([^;:\s]+)/i);
    if (tzidMatch) tzid = tzidMatch[1];
    let dt;
    let finalIsAllDay = isExplicitlyAllDay;
    try {
      if (isExplicitlyAllDay) {
        dt = luxon.DateTime.fromFormat(value, "yyyyMMdd", { zone: "utc" }).startOf("day");
      } else {
        const defaultZoneForFloating = luxon.Settings.defaultZoneName || luxon.DateTime.local().zoneName;
        if (value.endsWith("Z")) {
          dt = luxon.DateTime.fromISO(value, { zone: "utc" });
          finalIsAllDay = false;
        } else if (tzid && luxon.IANAZone.isValidZone(tzid)) {
          dt = luxon.DateTime.fromFormat(value, "yyyyMMdd'T'HHmmss", { zone: tzid });
          if (!dt.isValid) dt = luxon.DateTime.fromISO(value, { zone: tzid });
          finalIsAllDay = false;
        } else if (!value.includes("T") && /^\d{8}$/.test(value)) {
          dt = luxon.DateTime.fromFormat(value, "yyyyMMdd", { zone: defaultZoneForFloating }).startOf("day");
          finalIsAllDay = true;
        } else {
          dt = luxon.DateTime.fromFormat(value, "yyyyMMdd'T'HHmmss", { zone: defaultZoneForFloating });
          if (!dt.isValid) dt = luxon.DateTime.fromISO(value, { zone: defaultZoneForFloating });
          finalIsAllDay = false;
        }
      }
    } catch (parseError) {
      return { luxonUtcDateTime: null, isAllDay: finalIsAllDay, originalTzid: tzid };
    }
    if (!dt || !dt.isValid) {
      return { luxonUtcDateTime: null, isAllDay: finalIsAllDay, originalTzid: tzid };
    }
    return {
      luxonUtcDateTime: dt.toUTC(), // Ensure result is UTC, esp. for timed or local all-day
      isAllDay: finalIsAllDay,
      originalTzid: tzid,
    };
  },

  formatIcsDateTime: function (luxonDateTime, isAllDayEvent, tzid = null) {
    if (!luxonDateTime || !luxonDateTime.isValid) return "";
    if (isAllDayEvent) {
      return `VALUE=DATE:${luxonDateTime.toFormat("yyyyMMdd")}`;
    } else {
      if (tzid && luxon.IANAZone.isValidZone(tzid)) {
        return `${luxonDateTime.setZone(tzid).toFormat("yyyyMMdd'T'HHmmss")}`;
      } else {
        return `${luxonDateTime.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
      }
    }
  },

  escapeIcsField: function (field) {
    if (field == null) return "";
    return String(field).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  },

  unescapeIcsField: function (field) {
    if (field == null) return "";
    let result = String(field);
    result = result.replace(/\\n/gi, "\n");
    result = result.replace(/\\,/g, ",");
    result = result.replace(/\\;/g, ";");
    result = result.replace(/\\\\/g, "\\");
    return result;
  },

  areSameDate: function (dt1, dt2) {
    if (!dt1 || !(dt1 instanceof luxon.DateTime) || !dt1.isValid || !dt2 || !(dt2 instanceof luxon.DateTime) || !dt2.isValid) {
      return false;
    }
    return dt1.hasSame(dt2, "day");
  },

  timeToFraction: function (timeString) {
    if (!timeString || typeof timeString !== "string") return null;
    const parts = timeString.split(":");
    if (parts.length !== 2) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return (hours * 60 + minutes) / (24 * 60);
  },
};

const HtmlUtils = {
  sanitizeHtml: function (dirtyHtml) {
    if (!dirtyHtml || typeof dirtyHtml !== "string") return "";

    // Replace escaped newlines from ICS with <br> tags for HTML display
    // This should happen before attempting to parse with innerHTML
    let html = dirtyHtml.replace(/\\n/gi, "<br>");
    html = html.replace(/\n/g, "<br>"); // Also handle actual newlines if any

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    const allowedTags = ["B", "STRONG", "I", "EM", "U", "BR", "P", "UL", "OL", "LI", "A", "SPAN", "DIV", "FONT"]; // Added FONT for the example
    const allowedAttributes = ["href", "target", "title", "style", "color", "face", "size"]; // Added FONT attributes

    const sanitizeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent);
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagNameUpper = node.tagName.toUpperCase();
        if (!allowedTags.includes(tagNameUpper)) {
          const fragment = document.createDocumentFragment();
          for (const child of Array.from(node.childNodes)) {
            fragment.appendChild(sanitizeNode(child));
          }
          return fragment;
        }

        const newNode = document.createElement(node.tagName);
        for (const attr of Array.from(node.attributes)) {
          const attrNameLower = attr.name.toLowerCase();
          if (allowedAttributes.includes(attrNameLower)) {
            if (attrNameLower === "href") {
              if (attr.value.startsWith("http:") || attr.value.startsWith("https:") || attr.value.startsWith("mailto:")) {
                newNode.setAttribute(attr.name, attr.value);
              }
            } else if (attrNameLower === "style") {
              let styleValue = attr.value.toLowerCase();
              if (!styleValue.includes("url(") && !styleValue.includes("expression(") && !styleValue.includes("javascript:")) {
                newNode.setAttribute(attr.name, attr.value);
              }
            } else {
              newNode.setAttribute(attr.name, attr.value);
            }
          }
        }
        for (const child of Array.from(node.childNodes)) {
          newNode.appendChild(sanitizeNode(child));
        }
        return newNode;
      }
      return document.createDocumentFragment();
    };

    const sanitizedFragment = document.createDocumentFragment();
    for (const child of Array.from(tempDiv.childNodes)) {
      sanitizedFragment.appendChild(sanitizeNode(child));
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(sanitizedFragment);
    return wrapper.innerHTML;
  },
};
