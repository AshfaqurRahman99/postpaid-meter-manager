"use client";
import { useState, useEffect } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// ---------------- TypeScript Interfaces ----------------
interface MeterConfig {
  useCarryLogic: boolean;
  target: number;
  maxCarry: number;
}

interface HistoryRecord {
  month: string;
  rawInput: number;
  consumed: number;
  billed: number;
  carry: number;
  reading: number;
  prevReading: number;
  prevCarry: number;
  config: MeterConfig;
  isLocked: boolean;
  updatedAt: string;
}

interface MeterData {
  meterNumber: string;
  isActive: boolean;
  useCarryLogic: boolean;
  target: number;
  maxCarry: number;
  currentCarry: number;
  lastReading: number;
  history: HistoryRecord[];
}

interface MetersState {
  [key: string]: MeterData;
}

interface WzpdclStep {
  name: string;
  rate: number;
  units: number;
  charge: number;
}

interface WzpdclBillData {
  steps: WzpdclStep[];
  energyCharge: number;
  demandCharge: number;
  principal: number;
  vat: number;
  total: number;
  billedUnits: number;
}

interface CalcResult {
  consumed: number;
  billedUnits: number;
  newCarry: number;
  newAdjustedReading: number;
  rawInput: number;
  carryAdjustedText: string;
}
// --------------------------------------------------------

const fallbackMeters: MetersState = {
  "Meter-1 (Flat A1)": {
    meterNumber: "33445566", isActive: true, useCarryLogic: true, target: 200, maxCarry: 100, currentCarry: 100, lastReading: 6000,
    history: []
  }
};

const allMonths: string[] = [
  "January 2026", "February 2026", "March 2026", "April 2026",
  "May 2026", "June 2026", "July 2026", "August 2026",
  "September 2026", "October 2026", "November 2026", "December 2026"
];

export default function Home() {
  const currentDate = new Date();
  const currentMonthIndex = currentDate.getMonth();
  const currentDay = currentDate.getDate();

  const allowedMonthIndex = currentDay >= 15 ? currentMonthIndex : currentMonthIndex - 1;
  const availableMonths = allMonths.slice(0, allowedMonthIndex + 1);
  const defaultMonth = availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : allMonths[0];

  // Apply TS Types to States
  const [meters, setMeters] = useState<MetersState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedMeter, setSelectedMeter] = useState<string>("");
  const [billingMonth, setBillingMonth] = useState<string>(defaultMonth);
  const [actualReading, setActualReading] = useState<string>("");
  const [result, setResult] = useState<CalcResult | null>(null);

  const [isEditingConfig, setIsEditingConfig] = useState<boolean>(false);
  const [configForm, setConfigForm] = useState({ name: "", meterNumber: "", target: 0, maxCarry: 0, useCarryLogic: true, isActive: true });

  const [isAddingMeter, setIsAddingMeter] = useState<boolean>(false);
  const [addMeterForm, setAddMeterForm] = useState({ name: "", meterNumber: "", target: 200, maxCarry: 100, initialReading: 0, useCarryLogic: true });

  const [isInputUnlocked, setIsInputUnlocked] = useState<boolean>(false);

  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [showWzpdclModal, setShowWzpdclModal] = useState<boolean>(false);
  const [wzpdclBillData, setWzpdclBillData] = useState<WzpdclBillData | null>(null);

  // ---------------- Database Sync Logic ----------------
  useEffect(() => {
    fetch('/api/meters')
      .then(res => res.json())
      .then((data: MetersState) => {
        if (data && Object.keys(data).length > 0) {
          setMeters(data);
          setSelectedMeter(Object.keys(data)[0]);
        } else {
          setMeters(fallbackMeters);
          setSelectedMeter(Object.keys(fallbackMeters)[0]);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch data:", err);
        alert("ডেটাবেজ কানেকশনে সমস্যা হয়েছে! ডিফল্ট ডেটা লোড করা হচ্ছে।");
        setMeters(fallbackMeters);
        setSelectedMeter(Object.keys(fallbackMeters)[0]);
        setIsLoading(false);
      });
  }, []);

  const syncDatabase = async (updatedData: MetersState) => {
    try {
      await fetch('/api/meters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData)
      });
    } catch (err) {
      console.error("Database sync failed:", err);
      alert("⚠️ গুগল শিটে ডেটা সেভ হতে সমস্যা হয়েছে। ইন্টারনেট কানেকশন চেক করুন!");
    }
  };
  // --------------------------------------------------------

  if (isLoading || !meters) return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center animation-fade-in">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-2xl font-bold text-gray-700">Connecting to Google Sheets...</h2>
        <p className="text-gray-500 mt-2">দয়া করে অপেক্ষা করুন, ডেটাবেজ লোড হচ্ছে।</p>
      </div>
    </div>
  );

  const meter = meters[selectedMeter];

  const existingRecordIndex = meter?.history.findIndex(r => r.month === billingMonth);
  const existingRecord = existingRecordIndex >= 0 ? meter.history[existingRecordIndex] : null;
  const isEditMode = !!existingRecord;
  const isLocked = existingRecord ? existingRecord.isLocked : false;

  const baseReading = isEditMode ? (existingRecord?.prevReading ?? 0) : (meter?.lastReading ?? 0);
  const baseCarry = isEditMode ? (existingRecord?.prevCarry ?? 0) : (meter?.currentCarry ?? 0);

  const calculateWzpdclBill = (units: number): WzpdclBillData => {
    let remaining = units;
    let energyCharge = 0;
    const steps: WzpdclStep[] = [];

    const slabs = [
      { name: "1st (0-75)", rate: 5.26, max: 75 },
      { name: "2nd (76-200)", rate: 7.20, max: 125 },
      { name: "3rd (201-300)", rate: 7.59, max: 100 },
      { name: "4th (301-400)", rate: 8.02, max: 100 },
      { name: "5th (401-600)", rate: 12.67, max: 200 },
      { name: "6th (600+)", rate: 14.61, max: Infinity }
    ];

    slabs.forEach(slab => {
      if (remaining > 0) {
        const stepUnits = Math.min(remaining, slab.max);
        const charge = stepUnits * slab.rate;
        steps.push({ name: slab.name, rate: slab.rate, units: stepUnits, charge });
        energyCharge += charge;
        remaining -= stepUnits;
      }
    });

    const demandCharge = 126;
    const principal = energyCharge + demandCharge;
    const vat = Math.round(principal * 0.05);
    const total = Math.round(principal + vat);

    return { steps, energyCharge: parseFloat(energyCharge.toFixed(2)), demandCharge, principal: parseFloat(principal.toFixed(2)), vat, total, billedUnits: units };
  };

  const openWzpdclBill = (units: number) => {
    setWzpdclBillData(calculateWzpdclBill(units));
    setShowWzpdclModal(true);
  };

  const downloadWzpdclBillPDF = () => {
    window.print();
  };

  // const downloadWzpdclBillPDF = () => {
  //   const input = document.getElementById("wzpdcl-printable-bill");
  //   if (!input) return;
  //   html2canvas(input, {
  //     scale: 2,
  //     useCORS: true,
  //     onclone: (documentClone) => {
  //       const el = documentClone.getElementById("wzpdcl-printable-bill");
  //       if (el) el.style.color = "#000000";
  //     }
  //   }).then((canvas) => {
  //     const imgData = canvas.toDataURL("image/png");
  //     const pdf = new jsPDF("p", "mm", "a5");
  //     const pdfWidth = pdf.internal.pageSize.getWidth();
  //     const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
  //     pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  //     pdf.save(`WZPDCL_Estimated_Bill_${selectedMeter.split(" ")[0]}_${billingMonth}.pdf`);
  //   });
  // };

  const downloadSinglePDF = () => {
    window.print();
  };

  // const downloadSinglePDF = () => {
  //   const input = document.getElementById("bill-receipt");
  //   if (!input) return;
  //   html2canvas(input, {
  //     scale: 2,
  //     useCORS: true,
  //     // html2canvas এর লেটেস্ট ভার্সনে lab কালার এরর এড়াতে অনক্লোন হুক ব্যবহার করা
  //     onclone: (documentClone) => {
  //       const el = documentClone.getElementById("bill-receipt");
  //       if (el) el.style.color = "#000000";
  //     }
  //   }).then((canvas) => {
  //     const imgData = canvas.toDataURL("image/png");
  //     const pdf = new jsPDF("p", "mm", "a4");
  //     const pdfWidth = pdf.internal.pageSize.getWidth();
  //     const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
  //     pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  //     pdf.save(`Bill_${selectedMeter.split(" ")[0]}_${billingMonth}.pdf`);
  //   });
  // };

  const calculateBilling = (rawInputVal: number, currentMeterConfig: MeterConfig, prevReading: number, prevCarry: number): CalcResult | null => {
    const consumed = rawInputVal - prevReading;
    if (consumed < 0) return null;

    let billedUnits = consumed;
    let newCarry = prevCarry;
    let carryAdjustedText = "";

    if (currentMeterConfig.useCarryLogic !== false) {
      if (consumed > currentMeterConfig.target) {
        const excess = consumed - currentMeterConfig.target;
        const allowedToCarry = Math.min(excess, currentMeterConfig.maxCarry - prevCarry);
        newCarry = prevCarry + allowedToCarry;
        billedUnits = consumed - allowedToCarry;
      } else if (consumed < currentMeterConfig.target && prevCarry > 0) {
        const deficit = currentMeterConfig.target - consumed;
        const allowedToPull = Math.min(deficit, prevCarry);
        newCarry = prevCarry - allowedToPull;
        billedUnits = consumed + allowedToPull;
      }

      const carryDiff = billedUnits - consumed;
      carryAdjustedText = carryDiff === 0 ? "" : carryDiff > 0 ? `(+${carryDiff} from Carry)` : `(${carryDiff} to Carry)`;
    } else {
      newCarry = 0;
      billedUnits = consumed;
    }

    const newAdjustedReading = prevReading + billedUnits;
    return { consumed, billedUnits, newCarry, newAdjustedReading, rawInput: rawInputVal, carryAdjustedText };
  };

  let displayResult = result;
  if (!displayResult && existingRecord) {
    const savedConfig = existingRecord.config || { useCarryLogic: meter.useCarryLogic, target: meter.target, maxCarry: meter.maxCarry };
    const dynamicCalc = calculateBilling(existingRecord.rawInput, savedConfig, baseReading, baseCarry);
    if (dynamicCalc) {
      displayResult = dynamicCalc;
    } else {
      displayResult = {
        rawInput: existingRecord.rawInput, consumed: existingRecord.consumed, billedUnits: existingRecord.billed,
        newCarry: existingRecord.carry, newAdjustedReading: existingRecord.reading, carryAdjustedText: ""
      };
    }
  }

  const openEditConfig = () => {
    setConfigForm({
      name: selectedMeter, meterNumber: meter.meterNumber || "", target: meter.target, maxCarry: meter.maxCarry,
      useCarryLogic: meter.useCarryLogic !== false, isActive: meter.isActive !== false
    });
    setIsEditingConfig(true);
  };

  const saveConfig = () => {
    if (!configForm.name.trim()) return alert("মিটারের নাম ফাঁকা রাখা যাবে না!");

    const updatedMeters: MetersState = { ...meters };
    const newTarget = Number(configForm.target);
    const newMaxCarry = Number(configForm.maxCarry);

    if (configForm.name !== selectedMeter) {
      if (updatedMeters[configForm.name]) return alert("এই নামের আরেকটি মিটার ইতিমধ্যে সিস্টেমে আছে!");
      updatedMeters[configForm.name] = {
        ...updatedMeters[selectedMeter], meterNumber: configForm.meterNumber, target: newTarget, maxCarry: newMaxCarry,
        useCarryLogic: configForm.useCarryLogic, isActive: configForm.isActive
      };
      delete updatedMeters[selectedMeter];
      setSelectedMeter(configForm.name);
    } else {
      updatedMeters[selectedMeter].meterNumber = configForm.meterNumber;
      updatedMeters[selectedMeter].target = newTarget;
      updatedMeters[selectedMeter].maxCarry = newMaxCarry;
      updatedMeters[selectedMeter].useCarryLogic = configForm.useCarryLogic;
      updatedMeters[selectedMeter].isActive = configForm.isActive;
    }

    setMeters(updatedMeters);
    syncDatabase(updatedMeters);
    setIsEditingConfig(false);
    setResult(null);
  };

  const saveNewMeter = () => {
    if (!addMeterForm.name.trim()) return alert("মিটারের নাম দিতে হবে!");
    if (meters[addMeterForm.name]) return alert("এই নামের একটি মিটার ইতিমধ্যে সিস্টেমে আছে!");

    const newTarget = Number(addMeterForm.target);
    const newMaxCarry = Number(addMeterForm.maxCarry);

    const updatedMeters: MetersState = {
      ...meters,
      [addMeterForm.name]: {
        meterNumber: addMeterForm.meterNumber, target: newTarget, maxCarry: newMaxCarry, currentCarry: 0, lastReading: Number(addMeterForm.initialReading),
        history: [], useCarryLogic: addMeterForm.useCarryLogic, isActive: true
      }
    };

    setMeters(updatedMeters);
    syncDatabase(updatedMeters);
    setIsAddingMeter(false);
    setSelectedMeter(addMeterForm.name);
    setResult(null);
    setActualReading("");
    alert("নতুন মিটার সফলভাবে ডাটাবেজে যুক্ত হয়েছে!");
  };

  const handleCalculate = () => {
    if (meter.isActive === false) return alert("এই মিটারটি বর্তমানে Inactive বা বন্ধ আছে!");
    if (isLocked) return alert("এই মাসের বিল ইতিমধ্যে লক করা হয়েছে!");

    const rawInputValue = Number(actualReading);
    const calcResult = calculateBilling(rawInputValue, meter, baseReading, baseCarry);

    if (!calcResult) {
      alert("ভুল রিডিং! বর্তমান রিডিং আগের রিডিংয়ের চেয়ে কম হতে পারে না।");
      return;
    }
    setResult(calcResult);
  };

  const handleSave = (shouldLock: boolean = false) => {
    const dataToSave = result || displayResult;
    if (!dataToSave) return alert("Nothing to save!");

    const currentDateTime = new Date().toLocaleString("en-US", {
      month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true
    });

    const configToSave: MeterConfig = result ? {
      useCarryLogic: meter.useCarryLogic,
      target: meter.target,
      maxCarry: meter.maxCarry
    } : (existingRecord?.config || {
      useCarryLogic: meter.useCarryLogic,
      target: meter.target,
      maxCarry: meter.maxCarry
    });

    const newRecord: HistoryRecord = {
      month: billingMonth,
      rawInput: dataToSave.rawInput,
      consumed: dataToSave.consumed,
      billed: dataToSave.billedUnits,
      carry: configToSave.useCarryLogic !== false ? dataToSave.newCarry : 0,
      reading: dataToSave.newAdjustedReading,
      prevReading: baseReading,
      prevCarry: baseCarry,
      config: configToSave,
      isLocked: shouldLock || (existingRecord ? existingRecord.isLocked : false),
      updatedAt: currentDateTime
    };

    let updatedHistory = [...meter.history];
    if (isEditMode) {
      updatedHistory[existingRecordIndex] = newRecord;
    } else {
      updatedHistory = [newRecord, ...meter.history];
    }

    const updatedMeters: MetersState = {
      ...meters,
      [selectedMeter]: {
        ...meter,
        lastReading: updatedHistory[0].reading,
        currentCarry: updatedHistory[0].carry,
        history: updatedHistory
      }
    };

    setMeters(updatedMeters);
    syncDatabase(updatedMeters);
    setResult(null);
    setActualReading("");
    setIsInputUnlocked(false);

    if (shouldLock) {
      alert(`${billingMonth} মাসের বিল সফলভাবে ডাটাবেজে ফাইনাল এবং লক করা হয়েছে!`);
    } else {
      alert(isEditMode ? `${billingMonth} মাসের বিল সফলভাবে ডাটাবেজে আপডেট করা হয়েছে!` : `${billingMonth} মাসের নতুন ডেটা ডাটাবেজে সেভ করা হয়েছে!`);
    }
  };

  const handleMasterLock = () => {
    const confirmLock = confirm(`আপনি কি ${billingMonth} মাসের সব অ্যাকটিভ মিটারের বিল ফাইনাল/লক করতে চান?\nলক করার পর কোনো মিটারের ইউনিটে আর পরিবর্তন করা যাবে না!`);
    if (!confirmLock) return;

    const updatedMeters: MetersState = { ...meters };
    Object.keys(updatedMeters).forEach(m => {
      if (updatedMeters[m].isActive !== false) {
        const recordIndex = updatedMeters[m].history.findIndex(r => r.month === billingMonth);
        if (recordIndex >= 0) {
          updatedMeters[m].history[recordIndex].isLocked = true;
        }
      }
    });

    setMeters(updatedMeters);
    syncDatabase(updatedMeters);
    alert(`${billingMonth} মাসের সব বিল ডাটাবেজে সফলভাবে লক করা হয়েছে!`);
  };

  const handleOpenReport = () => {
    const missingMeters = Object.keys(meters).filter((m) => {
      const isActive = meters[m].isActive !== false;
      const hasData = meters[m].history.some((record) => record.month === billingMonth);
      return isActive && !hasData;
    });

    if (missingMeters.length > 0) {
      alert(`⚠️ রিপোর্ট তৈরি করা যাচ্ছে না!\n\nনিচের মিটারগুলোতে ${billingMonth} এর ডেটা এখনও এন্ট্রি করা হয়নি:\n\n- ${missingMeters.join("\n- ")}\n\nদয়া করে সব অ্যাকটিভ মিটারের ডেটা সেভ করার পর রিপোর্ট জেনারেট করুন।`);
      return;
    }
    setShowReportModal(true);
  };

  const triggerReportDownload = () => {
    window.print();
  };

  // const triggerReportDownload = () => {
  //   const input = document.getElementById("printable-report");
  //   if (!input) return;
  //   html2canvas(input, {
  //     scale: 2,
  //     useCORS: true,
  //     onclone: (documentClone) => {
  //       const el = documentClone.getElementById("printable-report");
  //       if (el) el.style.color = "#000000";
  //     }
  //   }).then((canvas) => {
  //     const imgData = canvas.toDataURL("image/png");
  //     const pdf = new jsPDF("l", "mm", "a4");
  //     const pdfWidth = pdf.internal.pageSize.getWidth();
  //     const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
  //     pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  //     pdf.save(`All_Meters_Report_${billingMonth}.pdf`);
  //   });
  // };

  const getShortMonth = (monthString: string): string => {
    const parts = monthString.split(" ");
    if (parts.length < 2) return monthString;
    return `${parts[0].substring(0, 3)} '${parts[1].substring(2)}`;
  };

  if (!meter) return <div className="p-10">Loading...</div>;

  const isCarryDisabledDisplay = result ? (meter.useCarryLogic === false) : (existingRecord ? existingRecord.config?.useCarryLogic === false : meter.useCarryLogic === false);

  const isMasterLocked = Object.keys(meters)
    .filter(m => meters[m].isActive !== false)
    .every(m => meters[m].history.find(r => r.month === billingMonth)?.isLocked);

  return (
    <div className="flex h-screen bg-gray-100 font-sans text-gray-800 overflow-hidden relative">

      {/* ---------------- Single WZPDCL Bill Modal ---------------- */}
      {showWzpdclModal && wzpdclBillData && (
        <div className="fixed inset-0 bg-black/80 z-[110] flex flex-col items-center overflow-y-auto p-4 sm:p-10 animation-fade-in custom-scrollbar">
          <div className="w-full max-w-[600px] flex justify-end gap-3 mb-4">
            {!isLocked ? (
              <button
                onClick={() => { handleSave(true); setShowWzpdclModal(false); }}
                className="bg-blue-600 text-white hover:bg-blue-700 px-8 py-2.5 rounded-lg font-extrabold shadow-lg flex items-center gap-2 border border-transparent transition-all"
              >
                ✅ OK
              </button>
            ) : (
              <button disabled className="bg-gray-300 text-gray-600 px-8 py-2.5 rounded-lg font-extrabold flex items-center gap-2 cursor-not-allowed">
                🔒 Locked
              </button>
            )}

            <button onClick={downloadWzpdclBillPDF} className="bg-white text-green-700 hover:bg-green-50 px-5 py-2.5 rounded-lg font-extrabold shadow-lg flex items-center gap-2 border border-transparent transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download
            </button>
            <button onClick={() => setShowWzpdclModal(false)} className="bg-red-500 text-white hover:bg-red-600 px-5 py-2.5 rounded-lg font-extrabold shadow-lg flex items-center gap-2 transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              Close
            </button>
          </div>

          <div id="wzpdcl-printable-bill" style={{ backgroundColor: "#ffffff", padding: "32px", fontFamily: "sans-serif", color: "#111827", width: "100%", maxWidth: "600px", borderTop: "8px solid #2563eb" }}>
            <div className="text-center border-b-2 border-gray-200 pb-4 mb-4">
              <h2 className="text-xl font-extrabold uppercase tracking-wider text-blue-800">Estimated Electricity Bill</h2>
              <p className="text-xs text-gray-500 mt-1 uppercase font-bold">Based on WZPDCL LT-A Tariff</p>
            </div>

            <div className="flex justify-between mb-6 text-sm font-semibold text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-100">
              <div>
                <p>Meter: <span className="text-gray-900 font-extrabold text-lg">{selectedMeter.split(" ")[0]}</span></p>
                <p>Meter No: <span className="font-mono text-blue-700 font-bold text-base">{meter.meterNumber || "N/A"}</span></p>
              </div>
              <div className="text-right">
                <p>Month: <span className="text-blue-700 font-extrabold">{billingMonth}</span></p>
                <p>Billed Units: <span className="text-gray-900 font-extrabold">{wzpdclBillData.billedUnits} kWh</span></p>
              </div>
            </div>

            <table className="w-full text-left text-sm mb-6 border border-gray-200">
              <thead className="bg-blue-50 text-blue-900">
                <tr>
                  <th className="p-2 border-b border-gray-200">Slab (Units)</th>
                  <th className="p-2 border-b border-gray-200 text-center">Rate (Tk)</th>
                  <th className="p-2 border-b border-gray-200 text-center">Consumed</th>
                  <th className="p-2 border-b border-gray-200 text-right">Amount (Tk)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {wzpdclBillData.steps.map((step, idx) => (
                  <tr key={idx}>
                    <td className="p-2 text-gray-600 font-medium">{step.name}</td>
                    <td className="p-2 text-center text-gray-600">{step.rate.toFixed(2)}</td>
                    <td className="p-2 text-center font-bold text-gray-800">{step.units}</td>
                    <td className="p-2 text-right font-semibold text-gray-800">{step.charge.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="w-full flex justify-end">
              <div className="w-2/3">
                <table className="w-full text-sm font-semibold text-gray-700">
                  <tbody>
                    <tr>
                      <td className="py-1">Total Energy Charge:</td>
                      <td className="py-1 text-right">{wzpdclBillData.energyCharge.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="py-1">Demand Charge (3 kW):</td>
                      <td className="py-1 text-right">{wzpdclBillData.demandCharge.toFixed(2)}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pt-2 font-bold text-gray-900">Principal Amount:</td>
                      <td className="py-1 pt-2 text-right font-bold text-gray-900">{wzpdclBillData.principal.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="py-1">VAT (5%):</td>
                      <td className="py-1 text-right">{wzpdclBillData.vat.toFixed(2)}</td>
                    </tr>
                    <tr className="border-t-2 border-gray-800 text-lg text-blue-800">
                      <td className="py-2 font-extrabold uppercase">Total Payable:</td>
                      <td className="py-2 text-right font-extrabold">৳ {wzpdclBillData.total.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-6 text-center text-[10px] text-gray-400 border-t border-gray-100 pt-3">
              Generated digitally via Smart Meter Dashboard at {new Date().toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Master Report Modal ---------------- */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center overflow-y-auto p-4 sm:p-10 animation-fade-in custom-scrollbar">

          <div className="w-full max-w-[1050px] flex justify-end gap-3 mb-4">
            {!isMasterLocked ? (
              <button
                onClick={handleMasterLock}
                className="bg-blue-600 text-white hover:bg-blue-700 px-8 py-2.5 rounded-lg font-extrabold shadow-lg flex items-center gap-2 border border-transparent transition-all"
              >
                ✅ OK
              </button>
            ) : (
              <button disabled className="bg-gray-300 text-gray-600 px-8 py-2.5 rounded-lg font-extrabold flex items-center gap-2 cursor-not-allowed">
                🔒 All Locked
              </button>
            )}

            <button onClick={triggerReportDownload} className="bg-white text-blue-700 hover:bg-blue-50 px-5 py-2.5 rounded-lg font-extrabold shadow-lg flex items-center gap-2 border border-transparent transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download PDF
            </button>
            <button onClick={() => setShowReportModal(false)} className="bg-red-500 text-white hover:bg-red-600 px-5 py-2.5 rounded-lg font-extrabold shadow-lg flex items-center gap-2 border-2 border-red-600 hover:border-red-700 transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              Close
            </button>
          </div>

          <div id="printable-report" className="bg-white p-12 font-sans text-gray-900 w-full max-w-[1050px] shadow-2xl rounded-xl">
            <div className="text-center border-b-2 border-gray-800 pb-5 mb-6">
              <h2 className="text-3xl font-extrabold uppercase tracking-widest text-gray-900">Monthly Billing Report</h2>
              <p className="text-xl font-bold mt-2 text-blue-800">{billingMonth}</p>
              <p className="text-sm text-gray-500 mt-1 font-medium">Generated: {new Date().toLocaleString()}</p>
            </div>

            <table className="w-full text-left text-sm border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100 text-gray-800">
                  <th className="border border-gray-300 p-3 font-bold">Meter Details</th>
                  <th className="border border-gray-300 p-3 font-bold">Present Unit (Adj)</th>
                  <th className="border border-gray-300 p-3 font-bold">Previous Unit</th>
                  <th className="border border-gray-300 p-3 font-bold">Consumed (Billed)</th>
                  <th className="border border-gray-300 p-3 font-bold">Actual (Raw Input)</th>
                  <th className="border border-gray-300 p-3 font-bold">Carry Unit</th>
                  <th className="border border-gray-300 p-3 font-bold text-blue-700">Estimate Amt (Tk)*</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(meters).map(m => {
                  const meterData = meters[m];
                  if (meterData.isActive === false) {
                    return (
                      <tr key={m} className="border-b border-gray-200 bg-gray-50 text-gray-400">
                        <td className="border border-gray-300 p-3">
                          <div className="font-extrabold text-base">{m.split(" ")[0]}</div>
                          <div className="text-sm font-mono font-bold mt-1">No: {meterData.meterNumber || "N/A"}</div>
                        </td>
                        <td className="border border-gray-300 p-3 text-center tracking-widest font-bold" colSpan={6}>INACTIVE</td>
                      </tr>
                    );
                  }
                  const record = meterData.history.find(h => h.month === billingMonth);
                  if (record) {
                    const estimateBillData = calculateWzpdclBill(record.billed);
                    const useCarry = record.config ? record.config.useCarryLogic : meterData.useCarryLogic;

                    return (
                      <tr key={m} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="border border-gray-300 p-3">
                          <div className="font-extrabold text-gray-900 text-base">{m.split(" ")[0]}</div>
                          <div className="text-sm text-blue-700 font-mono font-bold mt-1">No: {meterData.meterNumber || "N/A"}</div>
                        </td>
                        <td className="border border-gray-300 p-3 font-semibold text-blue-800 text-base">{record.reading}</td>
                        <td className="border border-gray-300 p-3">{record.prevReading}</td>
                        <td className="border border-gray-300 p-3 font-semibold">{record.billed}</td>
                        <td className="border border-gray-300 p-3">{record.rawInput || record.consumed}</td>
                        <td className="border border-gray-300 p-3 text-orange-600 font-semibold">{useCarry !== false ? record.carry : "N/A"}</td>
                        <td className="border border-gray-300 p-3 font-bold text-blue-700">৳ {estimateBillData.total.toLocaleString()}</td>
                      </tr>
                    );
                  }
                  return null;
                })}
              </tbody>
            </table>
            <div className="mt-4 text-xs text-gray-500 italic font-medium">
              * Estimate Amount is calculated based on standard WZPDCL LT-A residential tariff slabs including 5% VAT and Demand Charge.
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Add Meter Modal ---------------- */}
      {isAddingMeter && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md animation-fade-in">
            <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">➕ Add New Meter</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Meter Name (e.g. Meter-12 (Flat F1)):</label>
                <input type="text" className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" value={addMeterForm.name} onChange={e => setAddMeterForm({ ...addMeterForm, name: e.target.value })} placeholder="Meter Name" />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Meter Number:</label>
                  <input type="text" className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" value={addMeterForm.meterNumber} onChange={e => setAddMeterForm({ ...addMeterForm, meterNumber: e.target.value })} placeholder="e.g. 1029384" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Initial Reading:</label>
                  <input type="number" className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" value={addMeterForm.initialReading} onChange={e => setAddMeterForm({ ...addMeterForm, initialReading: Number(e.target.value) })} placeholder="e.g. 10500" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm font-bold text-blue-800 cursor-pointer pt-2">
                <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={addMeterForm.useCarryLogic} onChange={e => setAddMeterForm({ ...addMeterForm, useCarryLogic: e.target.checked })} />
                Enable Target & Carry System
              </label>

              {addMeterForm.useCarryLogic && (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Target Unit:</label>
                    <input type="number" className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" value={addMeterForm.target} onChange={e => setAddMeterForm({ ...addMeterForm, target: Number(e.target.value) })} />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Max Carry Limit:</label>
                    <input type="number" className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" value={addMeterForm.maxCarry} onChange={e => setAddMeterForm({ ...addMeterForm, maxCarry: Number(e.target.value) })} />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setIsAddingMeter(false)} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-200 transition">Cancel</button>
              <button onClick={saveNewMeter} className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 transition shadow-md">Save Meter</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Left Sidebar ---------------- */}
      <div className="w-1/4 max-w-[260px] bg-white shadow-xl flex flex-col h-full z-10">
        <div className="bg-blue-700 text-white p-5 text-center shadow-md relative">
          <h1 className="text-lg font-bold flex items-center justify-center gap-2 mt-4">
            ⚡ Smart Meter
          </h1>
          <button
            onClick={handleOpenReport}
            className="absolute top-3 left-3 bg-white/20 hover:bg-white/40 text-[10px] px-2 py-1 rounded transition-colors font-extrabold flex items-center gap-1 shadow-sm border border-blue-400"
            title="Download Complete Monthly Report"
          >
            📄 Report ({getShortMonth(billingMonth)})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar flex flex-col">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-2 mt-2">All Meters ({Object.keys(meters).length})</h3>

          <div className="space-y-1 flex-1">
            {Object.keys(meters).map((m) => {
              const meterData = meters[m];
              const isActive = meterData.isActive !== false;
              const monthRecord = meterData.history.find(record => record.month === billingMonth);
              const isUpdatedForMonth = !!monthRecord;
              const isMeterLockedForMonth = monthRecord?.isLocked;

              return (
                <button
                  key={m}
                  onClick={() => {
                    setSelectedMeter(m); setResult(null); setActualReading(""); setIsEditingConfig(false); setIsInputUnlocked(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 border border-transparent flex justify-between items-center ${selectedMeter === m
                    ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm"
                    : !isActive
                      ? "text-gray-400 opacity-60 hover:bg-gray-50"
                      : "text-gray-600 hover:bg-gray-50 hover:border-gray-200"
                    }`}
                >
                  <div className="flex items-center overflow-hidden pr-2 flex-wrap gap-x-1">
                    <span className="text-sm font-bold">{m.split(" ")[0]}</span>
                    {meterData.meterNumber && (
                      <span className="text-xs text-blue-600 font-mono font-bold">({meterData.meterNumber})</span>
                    )}
                  </div>
                  {isActive ? (
                    isMeterLockedForMonth ? (
                      <span className="text-[10px] bg-red-100 text-red-600 px-1 py-0.5 rounded font-bold" title="Locked">🔒</span>
                    ) : (
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isUpdatedForMonth ? 'bg-green-500' : 'bg-gray-300'}`} title={isUpdatedForMonth ? 'Updated' : 'Pending'}></span>
                    )
                  ) : (
                    <span className="text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-bold flex-shrink-0">INACTIVE</span>
                  )}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => setIsAddingMeter(true)}
            className="w-full mt-4 bg-gray-50 border border-dashed border-gray-300 text-gray-600 py-2.5 rounded-lg text-xs font-bold hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            + Add New Meter
          </button>
        </div>
      </div>

      {/* ---------------- Right Main Dashboard ---------------- */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 relative">
        <div className="w-full max-w-[1300px] mx-auto space-y-4 pb-10">

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex justify-between items-start">

            {!isEditingConfig ? (
              <div className="flex-1 flex justify-between items-center pr-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-3 flex-wrap">
                    {selectedMeter}
                    {meter.meterNumber && (
                      <span className="text-sm font-mono font-black text-blue-700 bg-blue-100 border border-blue-200 px-2 py-1 rounded shadow-sm">
                        No: {meter.meterNumber}
                      </span>
                    )}
                    {meter.isActive === false && <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded uppercase font-bold">Inactive</span>}
                    <button onClick={openEditConfig} className="text-xs bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 px-2 py-1 rounded transition-colors flex items-center gap-1 ml-2">
                      ✏️ Edit Setup
                    </button>
                  </h2>
                </div>

                <div className="flex gap-2">
                  {meter.useCarryLogic !== false ? (
                    <>
                      <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded text-xs font-bold">Target: {meter.target} Units</span>
                      <span className="bg-orange-50 text-orange-600 border border-orange-200 px-2 py-1 rounded text-xs font-bold">Max Carry: {meter.maxCarry} Units</span>
                    </>
                  ) : (
                    <span className="bg-gray-100 text-gray-600 border border-gray-200 px-3 py-1 rounded text-xs font-bold">Standard Billing (No Carry)</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 flex-1 mr-4 shadow-inner">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label className="flex items-center gap-2 text-sm font-bold text-blue-800 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={configForm.useCarryLogic} onChange={e => setConfigForm({ ...configForm, useCarryLogic: e.target.checked })} />
                      Enable Target & Carry System
                    </label>
                    <label className="flex items-center gap-2 text-sm font-bold text-red-600 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={configForm.isActive} onChange={e => setConfigForm({ ...configForm, isActive: e.target.checked })} />
                      Meter is Active
                    </label>
                  </div>

                  <div className="flex gap-3 items-end mt-1 border-t border-blue-100 pt-2">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-600 mb-1">Meter Name:</label>
                      <input type="text" className="w-full p-1.5 text-sm border border-blue-200 rounded focus:outline-none focus:border-blue-500" value={configForm.name} onChange={e => setConfigForm({ ...configForm, name: e.target.value })} />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-600 mb-1">Meter Number:</label>
                      <input type="text" className="w-full p-1.5 text-sm border border-blue-200 rounded focus:outline-none focus:border-blue-500" value={configForm.meterNumber} onChange={e => setConfigForm({ ...configForm, meterNumber: e.target.value })} placeholder="e.g. 123456" />
                    </div>
                    {configForm.useCarryLogic && (
                      <>
                        <div className="w-20">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Target:</label>
                          <input type="number" className="w-full p-1.5 text-sm border border-blue-200 rounded focus:outline-none focus:border-blue-500" value={configForm.target} onChange={e => setConfigForm({ ...configForm, target: Number(e.target.value) })} />
                        </div>
                        <div className="w-20">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Max Carry:</label>
                          <input type="number" className="w-full p-1.5 text-sm border border-blue-200 rounded focus:outline-none focus:border-blue-500" value={configForm.maxCarry} onChange={e => setConfigForm({ ...configForm, maxCarry: Number(e.target.value) })} />
                        </div>
                      </>
                    )}
                    <div className="flex gap-1 pb-0.5 ml-2">
                      <button onClick={saveConfig} className="bg-blue-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-blue-700">Save</button>
                      <button onClick={() => setIsEditingConfig(false)} className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 p-2 rounded-lg border border-blue-100 w-48 shrink-0">
              <label className="block text-blue-800 text-[10px] font-bold uppercase mb-0.5">Billing Month:</label>
              <select
                className="w-full bg-transparent border-b border-blue-200 focus:border-blue-600 focus:outline-none text-blue-900 text-sm font-semibold cursor-pointer pb-0.5"
                value={billingMonth}
                onChange={(e) => {
                  setBillingMonth(e.target.value); setResult(null); setActualReading(""); setIsInputUnlocked(false);
                }}
              >
                {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {meter.isActive === false ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <h2 className="text-2xl font-bold text-gray-400 mb-2">Meter is Currently Inactive</h2>
              <p className="text-gray-500">To add billing data, please Edit Setup and make the meter Active.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col h-full justify-between relative">

                {/* Lock Warning */}
                {isEditMode && (
                  <div className={`absolute top-0 left-0 w-full text-[11px] font-bold px-3 py-1.5 text-center rounded-t-xl border-b ${isLocked ? 'bg-red-100 text-red-800 border-red-200' : 'bg-yellow-100 text-yellow-800 border-yellow-200'}`}>
                    {isLocked ? "🔒 এই মাসের বিল ফাইনাল/লক করা হয়েছে। আর কোনো পরিবর্তন করা যাবে ইঞ্জিনিয়ারিং করা যাবে না।" : "⚠️ ডেটা ইতিমধ্যে সেভ করা আছে। পরিবর্তন করতে এডিট (✏️) বাটনে ক্লিক করুন।"}
                  </div>
                )}

                <div className={isEditMode ? "mt-5" : ""}>

                  <div className="flex justify-between items-center border-b pb-4 mb-5 mt-1">
                    <div className="text-left flex-1">
                      <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Previous</p>
                      <p className="text-3xl font-black text-gray-800">{baseReading}</p>
                    </div>

                    <div className="flex flex-col items-center justify-center flex-1 px-1">
                      <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-1.5">Carry Balance</p>
                      <div className="bg-orange-50 text-orange-600 border border-orange-200 px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                        {isCarryDisabledDisplay ? "N/A" : (displayResult ? displayResult.newCarry : baseCarry)} <span className="text-[10px] font-medium">{!isCarryDisabledDisplay ? "Units" : ""}</span>
                      </div>
                    </div>

                    <div className="text-right flex-1">
                      <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Present (Adj.)</p>
                      <p className={`text-3xl font-black ${displayResult ? "text-blue-600" : "text-gray-300"}`}>
                        {displayResult ? displayResult.newAdjustedReading : "---"}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-gray-700 font-semibold text-sm">
                        {billingMonth} এর একচুয়াল রিডিং:
                      </label>
                      {isEditMode && !isInputUnlocked && !isLocked && (
                        <button onClick={() => setIsInputUnlocked(true)} className="text-orange-600 hover:text-white hover:bg-orange-500 bg-orange-100 border border-orange-200 px-2 py-1 rounded text-xs font-bold transition-colors flex items-center gap-1 shadow-sm">
                          ✏️ Edit Input
                        </button>
                      )}
                    </div>

                    <input
                      type="number"
                      disabled={(isEditMode && !isInputUnlocked) || isLocked}
                      className={`w-full p-4 border-2 rounded-lg focus:outline-none focus:border-blue-500 text-xl font-medium transition-colors ${(isEditMode && !isInputUnlocked) || isLocked ? "bg-gray-100 border-gray-200 text-gray-600 cursor-not-allowed" : "border-gray-200 bg-white"
                        }`}
                      value={isEditMode && !isInputUnlocked ? (existingRecord?.rawInput || "") : actualReading}
                      onChange={(e) => setActualReading(e.target.value)}
                      placeholder={`e.g. ${baseReading + 210}`}
                    />

                    <div className="mt-3 flex justify-between items-start">
                      <div>
                        {(actualReading || (isEditMode && !isInputUnlocked && existingRecord?.rawInput)) ? (
                          <span className="bg-blue-100 text-blue-900 text-sm font-extrabold px-3 py-1.5 rounded-md border border-blue-200 shadow-sm inline-block">
                            Raw Input: {isEditMode && !isInputUnlocked ? existingRecord?.rawInput : actualReading}
                          </span>
                        ) : <span></span>}

                        {isCarryDisabledDisplay && (
                          <div className="text-gray-400 text-[10px] italic mt-1">Target & Carry Logic is Disabled</div>
                        )}
                      </div>

                      {(result || (isEditMode && !isInputUnlocked && existingRecord)) && (
                        <div className="text-right flex flex-col items-end">
                          <button
                            onClick={() => openWzpdclBill(result ? result.billedUnits : existingRecord.billed)}
                            className="bg-green-500 hover:bg-green-600 text-white text-[11px] font-extrabold px-3 py-1.5 rounded shadow transition-colors flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            📄 Bill Report
                          </button>
                          <p className="text-xs font-bold text-gray-700 mt-1">
                            BDT: {calculateWzpdclBill(result ? result.billedUnits : existingRecord.billed).total.toLocaleString()}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleCalculate}
                  disabled={(isEditMode && !isInputUnlocked) || isLocked}
                  className={`w-full text-white py-4 rounded-lg font-bold transition duration-200 text-lg mt-4 ${isLocked ? "bg-gray-300 cursor-not-allowed text-gray-500 shadow-none" : (isEditMode && !isInputUnlocked ? "bg-gray-300 cursor-not-allowed text-gray-500 shadow-none" : (isEditMode ? "bg-orange-500 hover:bg-orange-600 shadow-sm" : "bg-blue-600 hover:bg-blue-700 shadow-sm"))
                    }`}
                >
                  {isLocked ? "🔒 বিল লক করা হয়েছে" : (isEditMode ? "রি-ক্যালকুলেট করুন" : "ক্যালকুলেট করুন")}
                </button>
              </div>

              <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 flex flex-col justify-between">

                {!displayResult ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center space-y-2">
                    <svg className="w-12 h-12 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <p className="text-sm">রিডিং ইনপুট দিয়ে ক্যালকুলেট করুন,<br />ফলাফল এখানে দেখাবে।</p>
                  </div>
                ) : (
                  <div className="animation-fade-in flex flex-col h-full justify-between">

                    <div id="bill-receipt" style={{ backgroundColor: "#ffffff", padding: "20px", border: "1px solid #d1d5db", marginBottom: "16px" }}>

                      <div className="flex justify-between items-center border-b-2 border-gray-200 pb-3 mb-4">
                        <h2 className="text-base font-extrabold uppercase tracking-widest text-gray-900 m-0">Invoice Slip</h2>
                        <span className="text-sm font-bold text-gray-900 bg-gray-200 px-3 py-1 rounded-md">{getShortMonth(billingMonth)}</span>
                        <span className="text-sm font-extrabold text-gray-900 text-right">{selectedMeter.split(" ")[0]}</span>
                      </div>

                      <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-gray-100">
                          <tr>
                            <td className="py-2 text-gray-500">Raw Input Reading</td>
                            <td className="py-2 text-right font-medium text-gray-800">{displayResult.rawInput || "-"}</td>
                          </tr>
                          <tr>
                            <td className="py-2 text-gray-500">Previous Reading</td>
                            <td className="py-2 text-right font-medium">{baseReading}</td>
                          </tr>

                          <tr><td className="py-2 text-gray-500">Actual Consumed</td><td className="py-2 text-right font-medium">{displayResult.consumed}</td></tr>

                          <tr className="text-blue-700 bg-blue-50/50">
                            <td className="py-2 font-bold px-2 rounded-l flex flex-wrap items-center gap-1">
                              Billed Units
                              {displayResult.carryAdjustedText && !isCarryDisabledDisplay && (
                                <span className="text-[10px] bg-blue-100 px-1 py-0.5 rounded text-blue-600 font-bold whitespace-nowrap">
                                  {displayResult.carryAdjustedText}
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-right font-bold px-2 rounded-r">{displayResult.billedUnits}</td>
                          </tr>

                          <tr><td className="py-2 text-gray-500">New Adjusted Reading</td><td className="py-2 text-right font-bold text-gray-800">{displayResult.newAdjustedReading}</td></tr>

                          {!isCarryDisabledDisplay && (
                            <tr className="text-orange-600"><td className="py-2 font-bold">New Carry Balance</td><td className="py-2 text-right font-bold">{displayResult.newCarry} Units</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={downloadSinglePDF} className="flex-1 bg-white border border-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-50 font-bold transition text-sm">PDF Download</button>
                      {result && !isLocked && (
                        <button onClick={() => handleSave(false)} className={`flex-1 text-white py-3 rounded-lg shadow-sm font-bold transition text-sm ${isEditMode ? "bg-orange-500 hover:bg-orange-600" : "bg-green-500 hover:bg-green-600"
                          }`}>
                          {isEditMode ? "Update Database" : "Save to Database"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Billing History
            </h2>

            {meter.history && meter.history.length > 0 ? (
              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider text-xs border-b border-gray-200">
                    <tr>
                      <th className="p-4 font-bold">Updated At</th>
                      <th className="p-4 font-bold">Month</th>
                      <th className="p-4 font-bold">Raw Input</th>
                      <th className="p-4 font-bold">Consumed</th>
                      <th className="p-4 font-bold text-blue-700">Billed</th>
                      <th className="p-4 font-bold text-orange-600">Carry</th>
                      <th className="p-4 font-bold">Adj. Reading</th>
                      <th className="p-4 font-bold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {meter.history.map((record, index) => {
                      const isCarryOff = record.config ? record.config.useCarryLogic === false : meter.useCarryLogic === false;
                      return (
                        <tr key={index} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 text-gray-500">{record.updatedAt}</td>
                          <td className="p-4 font-semibold text-gray-800">{record.month}</td>
                          <td className="p-4 text-gray-600 font-mono">{record.rawInput || "-"}</td>
                          <td className="p-4 text-gray-600">{record.consumed}</td>
                          <td className="p-4 text-blue-600 font-bold">{record.billed}</td>
                          <td className="p-4 text-orange-500 font-bold">{!isCarryOff ? record.carry : "N/A"}</td>
                          <td className="p-4 font-bold text-gray-800">{record.reading}</td>
                          <td className="p-4 text-center">
                            {record.isLocked ? <span className="bg-red-100 text-red-600 text-[10px] px-2 py-1 rounded font-bold uppercase">Locked</span> : <span className="text-[10px] text-green-500 font-bold uppercase">Saved</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded border border-dashed border-gray-300 text-gray-500 text-sm">
                <p>এই মিটারের কোনো পূর্ববর্তী রেকর্ড নেই।</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}