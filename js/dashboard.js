/*
 * 코팅 설비 생산 대시보드
 * ------------------------
 * 이 파일은 선택한 CSV를 브라우저 안에서 읽고 화면을 갱신합니다.
 * 별도의 서버, 빌드 도구, 라이브러리가 필요하지 않습니다.
 *
 * 관리할 때 참고할 내용
 * 1. 아래 REQUIRED_HEADERS는 요약과 차트 계산에 반드시 필요한 CSV 열 이름입니다.
 * 2. CSV 열 이름이 바뀌면 REQUIRED_HEADERS 및 해당 열을 읽는 코드를 함께 변경하세요.
 * 3. 여러 CSV는 헤더 이름을 기준으로 합쳐 계산하고, 전체 표와 NG 전용 표 모두 표시합니다.
 * 4. 파일 내용은 서버로 보내지 않고 현재 브라우저에서만 처리합니다.
 */

(() => {
  "use strict";

  // CSV 요약 및 차트 계산에 필요한 최소한의 열입니다.
  const REQUIRED_HEADERS = [
    "생산일자",
    "설비명",
    "생산모델",
    "생산시간_분",
    "로스시간_분",
    "판정"
  ];

  // 화면의 각 영역과 이벤트를 연결하는 요소를 한 번만 찾아 둡니다.
  const fileInput = document.getElementById("csv-file");
  const fileStatus = document.getElementById("file-status");
  const statusMessage = document.getElementById("status-message");
  const summaryPeriod = document.getElementById("summary-period");
  const totalRollsElement = document.getElementById("total-rolls");
  const defectRateElement = document.getElementById("defect-rate");
  const defectCountElement = document.getElementById("defect-count");
  const operationRateElement = document.getElementById("operation-rate");
  const totalLossElement = document.getElementById("total-loss");
  const equipmentChart = document.getElementById("equipment-chart");
  const dateChart = document.getElementById("date-chart");
  const modelChart = document.getElementById("model-chart");
  const equipmentTimeContainer = document.getElementById("equipment-time-container");
  const ngTableContainer = document.getElementById("ng-table-container");
  const tableContainer = document.getElementById("table-container");
  const ngListCount = document.getElementById("ng-list-count");
  const allRollCount = document.getElementById("all-roll-count");

  // 화면 구조가 변경되어 필수 요소가 사라진 경우 콘솔에 원인을 명확히 남깁니다.
  const requiredElements = [
    fileInput,
    fileStatus,
    statusMessage,
    summaryPeriod,
    totalRollsElement,
    defectRateElement,
    defectCountElement,
    operationRateElement,
    totalLossElement,
    equipmentChart,
    dateChart,
    modelChart,
    equipmentTimeContainer,
    ngTableContainer,
    tableContainer,
    ngListCount,
    allRollCount
  ];

  if (requiredElements.some((element) => element === null)) {
    console.error("대시보드 초기화 실패: index.html에서 필요한 요소를 찾을 수 없습니다.");
    return;
  }

  /*
   * CSV 한 줄을 분리할 때 따옴표 안의 쉼표와 줄바꿈을 보존하는 파서입니다.
   * 예: "모델, A"는 두 개의 셀이 아니라 하나의 셀로 처리합니다.
   * CSV 표준의 큰따옴표 이스케이프("")도 지원합니다.
   */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let insideQuotes = false;
    const source = text.replace(/^\uFEFF/, "");

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];

      if (insideQuotes) {
        if (character === '"') {
          if (source[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else {
            insideQuotes = false;
          }
        } else {
          cell += character;
        }
        continue;
      }

      if (character === '"') {
        insideQuotes = true;
      } else if (character === ",") {
        row.push(cell);
        cell = "";
      } else if (character === "\n" || character === "\r") {
        // CRLF를 한 줄바꿈으로 취급하고, 남은 셀을 현재 행에 추가합니다.
        if (character === "\r" && source[index + 1] === "\n") {
          index += 1;
        }
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }

    // 파일 끝의 마지막 행은 줄바꿈이 없어도 결과에 포함되어야 합니다.
    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  /*
   * 최신 CSV의 UTF-8뿐 아니라 엑셀 등에서 저장한 한글 Windows CSV도 지원합니다.
   * UTF-8로 엄격하게 디코딩을 시도해 성공하면 그대로 사용하고, UTF-8 바이트가
   * 유효하지 않은 경우 브라우저 기본 문자셋 디코더의 euc-kr(CP949 호환)로 읽습니다.
   */
  async function readCsvFile(file) {
    const bytes = await file.arrayBuffer();
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

    try {
      return utf8Decoder.decode(bytes);
    } catch (utf8Error) {
      try {
        return new TextDecoder("euc-kr").decode(bytes);
      } catch (legacyEncodingError) {
        throw new Error("CSV 문자 인코딩을 읽을 수 없습니다. UTF-8 또는 한글 Windows 인코딩으로 저장해 주세요.", {
          cause: legacyEncodingError || utf8Error
        });
      }
    }
  }

  /*
   * 숫자가 들어 있는 셀을 안전하게 숫자로 바꿉니다.
   * 비어 있거나 숫자가 아닌 값은 NaN으로 반환하여 계산에서 제외할 수 있게 합니다.
   */
  function parseNumber(value) {
    const normalized = String(value ?? "").trim().replace(/,/g, "");
    if (normalized === "") {
      return Number.NaN;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  // 표시하는 모든 소수는 소수점 첫째 자리까지만 표현합니다.
  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 1
    }).format(value);
  }

  function setStatus(message, state) {
    statusMessage.textContent = message;
    fileStatus.classList.remove("is-loaded", "is-error");
    if (state) {
      fileStatus.classList.add(state);
    }
  }

  /*
   * 파일을 파싱한 뒤 각 행을 {헤더 이름: 셀 값} 형태로 변환합니다.
   * 행의 열 개수가 헤더보다 부족한 경우에는 빈 문자열로 채워 표의 모양을 유지합니다.
   */
  function makeRecords(rows) {
    if (rows.length < 2) {
      throw new Error("헤더와 생산 데이터가 포함된 CSV 파일을 선택해 주세요.");
    }

    const headers = rows[0].map((header) => header.trim());
    if (headers.some((header) => header === "")) {
      throw new Error("CSV 헤더에 비어 있는 열 이름이 있습니다.");
    }

    const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
    if (missingHeaders.length > 0) {
      throw new Error(`필수 열을 찾을 수 없습니다: ${missingHeaders.join(", ")}`);
    }

    const records = rows.slice(1)
      .filter((cells) => cells.some((value) => value.trim() !== ""))
      .map((cells) => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = (cells[index] ?? "").trim();
        });
        return record;
      });

    if (records.length === 0) {
      throw new Error("CSV 파일에 표시할 생산 데이터가 없습니다.");
    }

    return { headers, records };
  }

  /*
   * 각 요약 카드는 모두 롤 행을 기준으로 계산합니다.
   * 가동률은 요청된 정의대로 생산시간 합계 / (생산시간 합계 + 로스시간 합계)입니다.
   */
  function renderSummary(records) {
    const totalRolls = records.length;
    const defectCount = records.filter((record) => record["판정"].trim().toUpperCase() === "NG").length;

    const productionMinutes = records.reduce((sum, record) => {
      const value = parseNumber(record["생산시간_분"]);
      return sum + (Number.isNaN(value) ? 0 : value);
    }, 0);

    const lossMinutes = records.reduce((sum, record) => {
      const value = parseNumber(record["로스시간_분"]);
      return sum + (Number.isNaN(value) ? 0 : value);
    }, 0);

    const defectRate = totalRolls === 0 ? 0 : (defectCount / totalRolls) * 100;
    const totalAvailableMinutes = productionMinutes + lossMinutes;
    const operationRate = totalAvailableMinutes === 0
      ? 0
      : (productionMinutes / totalAvailableMinutes) * 100;

    totalRollsElement.textContent = formatNumber(totalRolls);
    defectRateElement.textContent = `${formatNumber(defectRate)}%`;
    defectCountElement.textContent = `${formatNumber(defectCount)}롤 / 전체 ${formatNumber(totalRolls)}롤`;
    operationRateElement.textContent = `${formatNumber(operationRate)}%`;
    totalLossElement.textContent = formatNumber(lossMinutes);

    const dates = records
      .map((record) => record["생산일자"].trim())
      .filter((date) => date !== "")
      .sort();

    if (dates.length === 0) {
      summaryPeriod.textContent = "생산일자 정보 없음";
    } else {
      const firstDate = dates[0];
      const lastDate = dates[dates.length - 1];
      summaryPeriod.textContent = firstDate === lastDate ? firstDate : `${firstDate} ~ ${lastDate}`;
    }
  }

  /*
   * 데이터 집계 결과를 퍼센트 높이의 div 막대로 렌더링합니다.
   * 라이브러리의 차트 객체나 canvas를 사용하지 않습니다.
   */
  function renderBarChart(container, entries, options = {}) {
    const { dateChartMode = false, labelFormatter = (label) => label } = options;
    const sortedEntries = [...entries];
    sortedEntries.sort((left, right) => left.label.localeCompare(right.label, "ko"));
    container.className = dateChartMode ? "bar-chart date-chart" : "bar-chart";

    if (sortedEntries.length === 0) {
      container.classList.add("empty-chart");
      container.innerHTML = '<p class="empty-message">표시할 생산 데이터가 없습니다.</p>';
      return;
    }

    const maximumCount = Math.max(...sortedEntries.map((entry) => entry.count), 1);
    const list = document.createElement("div");
    const compactDateAxis = dateChartMode && sortedEntries.length >= 10;
    list.className = compactDateAxis
      ? "vertical-bar-list compact-date-axis"
      : "vertical-bar-list";

    sortedEntries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "vertical-bar-item";

      const label = document.createElement("span");
      label.className = "vertical-bar-label";
      label.textContent = labelFormatter(entry.label);
      label.title = entry.label;

      const track = document.createElement("div");
      track.className = "vertical-bar-track";
      track.setAttribute("aria-label", `${entry.label}: ${formatNumber(entry.count)}롤`);

      const fill = document.createElement("div");
      fill.className = "vertical-bar-fill";
      fill.style.height = `${(entry.count / maximumCount) * 100}%`;
      fill.setAttribute("aria-hidden", "true");
      track.appendChild(fill);

      const value = document.createElement("span");
      value.className = "vertical-bar-value";
      value.textContent = formatNumber(entry.count);
      value.title = `${entry.label}: ${formatNumber(entry.count)}롤`;

      item.append(value, track, label);
      list.appendChild(item);
    });

    container.replaceChildren(list);
  }

  // 설비명과 모델명은 이름순, 날짜는 날짜순으로 정렬하고 막대는 모두 세로로 표시합니다.
  function renderCharts(records) {
    const equipmentCounts = new Map();
    const dateCounts = new Map();
    const modelCounts = new Map();

    records.forEach((record) => {
      const equipment = record["설비명"].trim() || "미지정";
      const date = record["생산일자"].trim() || "날짜 미지정";
      const model = record["생산모델"].trim() || "모델 미지정";
      equipmentCounts.set(equipment, (equipmentCounts.get(equipment) || 0) + 1);
      dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    });

    const equipmentEntries = Array.from(equipmentCounts, ([label, count]) => ({ label, count }));
    const dateEntries = Array.from(dateCounts, ([label, count]) => ({ label, count }));
    const modelEntries = Array.from(modelCounts, ([label, count]) => ({ label, count }));

    renderBarChart(equipmentChart, equipmentEntries);
    renderBarChart(dateChart, dateEntries, {
      dateChartMode: true,
      labelFormatter: (date) => date.length >= 10 ? date.slice(5) : date
    });
    renderBarChart(modelChart, modelEntries);
  }

  /*
   * CSV 셀 내용은 HTML로 해석하지 않고 textContent로 기록합니다.
   * 따라서 생산일지에 포함된 특수문자도 안전하게 일반 텍스트로 표시됩니다.
   */
  function renderTable(headers, records, container, options = {}) {
    const { className = "production-table", emptyMessage = "표시할 데이터가 없습니다." } = options;

    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.className = "table-empty";
      const message = document.createElement("p");
      message.textContent = emptyMessage;
      empty.appendChild(message);
      container.replaceChildren(empty);
      return;
    }

    const table = document.createElement("table");
    table.className = className;

    const tableHead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((header) => {
      const heading = document.createElement("th");
      heading.scope = "col";
      heading.textContent = header;
      headerRow.appendChild(heading);
    });
    tableHead.appendChild(headerRow);

    const tableBody = document.createElement("tbody");
    records.forEach((record) => {
      const row = document.createElement("tr");
      if (record["판정"].trim().toUpperCase() === "NG") {
        row.classList.add("ng-row");
      }

      headers.forEach((header) => {
        const cell = document.createElement("td");
        cell.textContent = record[header] ?? "";
        row.appendChild(cell);
      });

      tableBody.appendChild(row);
    });

    table.append(tableHead, tableBody);
    container.replaceChildren(table);
  }

  // 설비별 시간은 각 롤의 분 값을 합산하고 설비 이름 오름차순의 짝지은 세로 막대로 표시합니다.
  function renderEquipmentTimeChart(records) {
    const equipmentTimes = new Map();

    records.forEach((record) => {
      const equipment = record["설비명"].trim() || "미지정";
      const current = equipmentTimes.get(equipment) || { production: 0, loss: 0 };
      const production = parseNumber(record["생산시간_분"]);
      const loss = parseNumber(record["로스시간_분"]);
      current.production += Number.isNaN(production) ? 0 : production;
      current.loss += Number.isNaN(loss) ? 0 : loss;
      equipmentTimes.set(equipment, current);
    });

    const entries = Array.from(equipmentTimes.entries())
      .map(([label, times]) => ({ label, ...times }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko"));

    equipmentTimeContainer.className = "bar-chart equipment-time-chart";
    if (entries.length === 0) {
      equipmentTimeContainer.classList.add("empty-chart");
      equipmentTimeContainer.innerHTML = '<p class="empty-message">표시할 생산 데이터가 없습니다.</p>';
      return;
    }

    const maximumTime = Math.max(
      ...entries.flatMap((entry) => [entry.production, entry.loss]),
      1
    );
    const list = document.createElement("div");
    list.className = "equipment-time-list";

    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "equipment-time-item";

      const makeBar = (label, value, barClass) => {
        const column = document.createElement("div");
        column.className = `equipment-time-column ${barClass}`;

        const number = document.createElement("span");
        number.className = "equipment-time-value";
        number.textContent = formatNumber(value);

        const track = document.createElement("div");
        track.className = "equipment-time-track";
        track.setAttribute("aria-label", `${entry.label} ${label}: ${formatNumber(value)}분`);

        const fill = document.createElement("div");
        fill.className = "equipment-time-fill";
        fill.style.height = `${(value / maximumTime) * 100}%`;
        fill.setAttribute("aria-hidden", "true");
        track.appendChild(fill);
        column.append(number, track);
        return column;
      };

      const bars = document.createElement("div");
      bars.className = "equipment-time-bars";
      bars.append(
        makeBar("생산시간", entry.production, "production-time"),
        makeBar("로스시간", entry.loss, "loss-time")
      );

      const label = document.createElement("span");
      label.className = "equipment-time-label";
      label.textContent = entry.label;
      label.title = entry.label;

      item.append(bars, label);
      list.appendChild(item);
    });

    equipmentTimeContainer.replaceChildren(list);
  }

  /*
   * 여러 CSV의 헤더 이름을 합쳐 모든 파일의 열을 유지합니다.
   * 같은 열의 순서가 파일마다 다르더라도 열 이름 기준으로 안전하게 합쳐집니다.
   */
  function mergeCsvFiles(parsedFiles) {
    const headers = [];
    const records = [];

    parsedFiles.forEach(({ headers: fileHeaders, records: fileRecords }) => {
      fileHeaders.forEach((header) => {
        if (!headers.includes(header)) {
          headers.push(header);
        }
      });
      records.push(...fileRecords);
    });

    return { headers, records };
  }

  // 파일 선택창에서 여러 CSV를 고를 수 있으며, 선택된 파일 모두 읽기에 성공한 경우 합쳐 표시합니다.
  fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) {
      return;
    }

    const invalidFile = files.find((file) => !file.name.toLowerCase().endsWith(".csv"));
    if (invalidFile) {
      setStatus(`${invalidFile.name}: CSV 파일만 선택할 수 있습니다.`, "is-error");
      return;
    }

    setStatus(`${formatNumber(files.length)}개 CSV 파일을 읽고 있습니다.`, "");

    try {
      const parsedFiles = await Promise.all(files.map(async (file) => {
        try {
          const fileText = await readCsvFile(file);
          return makeRecords(parseCsv(fileText));
        } catch (error) {
          const reason = error instanceof Error ? error.message : "파일을 읽을 수 없습니다.";
          throw new Error(`${file.name}: ${reason}`, { cause: error });
        }
      }));
      const { headers, records } = mergeCsvFiles(parsedFiles);
      const ngRecords = records.filter((record) => record["판정"].trim().toUpperCase() === "NG");

      renderSummary(records);
      renderCharts(records);
      renderEquipmentTimeChart(records);
      renderTable(headers, ngRecords, ngTableContainer, {
        className: "production-table ng-production-table",
        emptyMessage: "NG 판정 항목이 없습니다."
      });
      renderTable(headers, records, tableContainer);
      ngListCount.textContent = `${formatNumber(ngRecords.length)}개 항목`;
      allRollCount.textContent = `${formatNumber(records.length)}개 롤`;
      const fileSummary = files.length === 1 ? files[0].name : `${formatNumber(files.length)}개 파일`;
      setStatus(`${fileSummary} · ${formatNumber(records.length)}개 롤을 불러왔습니다.`, "is-loaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CSV 파일을 읽는 중 알 수 없는 오류가 발생했습니다.";
      setStatus(message, "is-error");
      console.error("CSV 처리 실패:", error);
    }
  });
})();
