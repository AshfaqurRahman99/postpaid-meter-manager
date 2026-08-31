"use client";
import { useState } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// ডেমো ডেটা (পরবর্তীতে এটি গুগল শিট বা ডাটাবেস থেকে আসবে)
const initialMeters = {
    "Meter-1 (Flat A1)": { target: 200, maxCarry: 100, currentCarry: 0, lastReading: 5000 },
    "Meter-2 (Flat A2)": { target: 250, maxCarry: 150, currentCarry: 30, lastReading: 8200 },
    "Meter-3 (Flat B1)": { target: 200, maxCarry: 100, currentCarry: 50, lastReading: 3400 },
};

export default function Home() {
    const [meters, setMeters] = useState(initialMeters);
    const [selectedMeter, setSelectedMeter] = useState("Meter-1 (Flat A1)");
    const [actualReading, setActualReading] = useState("");
    const [result, setResult] = useState(null);

    const meter = meters[selectedMeter];

    const handleCalculate = () => {
        const consumed = Number(actualReading) - meter.lastReading;
        if (consumed < 0) {
            alert("ভুল রিডিং! বর্তমান রিডিং আগের রিডিংয়ের চেয়ে কম হতে পারে না।");
            return;
        }

        let billedUnits = consumed;
        let newCarry = meter.currentCarry;

        // লজিক ১: টার্গেটের বেশি খরচ হলে (ক্যারি হবে)
        if (consumed > meter.target) {
            const excess = consumed - meter.target;
            const allowedToCarry = Math.min(excess, meter.maxCarry - meter.currentCarry);
            newCarry = meter.currentCarry + allowedToCarry;
            billedUnits = consumed - allowedToCarry;
        }
        // লজিক ২: টার্গেটের কম খরচ হলে (ক্যারি থেকে এডজাস্ট হবে)
        else if (consumed < meter.target && meter.currentCarry > 0) {
            const deficit = meter.target - consumed;
            const allowedToPull = Math.min(deficit, meter.currentCarry);
            newCarry = meter.currentCarry - allowedToPull;
            billedUnits = consumed + allowedToPull;
        }

        const newAdjustedReading = meter.lastReading + billedUnits;

        setResult({
            consumed,
            billedUnits,
            newCarry,
            newAdjustedReading
        });
    };

    const handleSave = () => {
        setMeters({
            ...meters,
            [selectedMeter]: {
                ...meter,
                lastReading: result.newAdjustedReading,
                currentCarry: result.newCarry
            }
        });
        setResult(null);
        setActualReading("");
        alert("ডেটা সফলভাবে সেভ হয়েছে! (আপাতত লোকাল সিস্টেমে)");
    };

    const downloadPDF = () => {
        const input = document.getElementById("bill-receipt");
        if (!input) return;

        html2canvas(input, { scale: 2 }).then((canvas) => {
            const imgData = canvas.toDataURL("image/png");
            const pdf = new jsPDF("p", "mm", "a4");

            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
            pdf.save(`Bill_${selectedMeter}.pdf`);
        });
    };

    return (
        <div className="min-h-screen bg-gray-50 py-10 px-4 font-sans text-gray-800">
            <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">

                {/* Header */}
                <div className="bg-blue-600 text-white p-6 text-center">
                    <h1 className="text-2xl font-bold">⚡ Smart Meter Adjuster</h1>
                    <p className="text-sm mt-1 opacity-80">Electricity Bill Optimization System</p>
                </div>

                <div className="p-8">
                    {/* Meter Selection */}
                    <div className="mb-6">
                        <label className="block text-gray-700 mb-2 font-semibold">মিটার সিলেক্ট করুন:</label>
                        <select
                            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={selectedMeter}
                            onChange={(e) => { setSelectedMeter(e.target.value); setResult(null); setActualReading(""); }}
                        >
                            {Object.keys(meters).map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>

                    {/* Meter Info Card */}
                    <div className="bg-blue-50 border border-blue-100 p-5 rounded-lg mb-6 flex justify-between text-sm">
                        <div>
                            <p className="mb-1"><strong>টার্গেট ইউনিট:</strong> {meter.target}</p>
                            <p><strong>ম্যাক্স ক্যারি:</strong> {meter.maxCarry}</p>
                        </div>
                        <div className="text-right">
                            <p className="mb-1"><strong>পূর্ববর্তী রিডিং:</strong> <span className="text-lg font-bold text-blue-600">{meter.lastReading}</span></p>
                            <p><strong>জমা থাকা ক্যারি:</strong> <span className="text-orange-500 font-bold">{meter.currentCarry}</span></p>
                        </div>
                    </div>

                    {/* Input Section */}
                    <div className="mb-8">
                        <label className="block text-gray-700 mb-2 font-semibold">আজকের একচুয়াল রিডিং দিন:</label>
                        <input
                            type="number"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                            value={actualReading}
                            onChange={(e) => setActualReading(e.target.value)}
                            placeholder={`e.g. ${meter.lastReading + 210}`}
                        />
                    </div>

                    <button
                        onClick={handleCalculate}
                        className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-bold transition duration-200"
                    >
                        ক্যালকুলেট করুন
                    </button>

                    {/* Results & Bill Format */}
                    {result && (
                        <div className="mt-8 pt-8 border-t border-gray-200">

                            {/* Hidden/Printable Bill Format */}
                            <div id="bill-receipt" className="bg-white p-8 border-2 border-gray-800 mx-auto mb-6" style={{ maxWidth: "500px" }}>
                                <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
                                    <h2 className="text-2xl font-bold uppercase tracking-wider">Electricity Bill</h2>
                                    <p className="text-sm">Smart Auto-Adjusted Invoice</p>
                                </div>

                                <div className="mb-6 text-sm">
                                    <p className="mb-1"><strong>Meter Name:</strong> {selectedMeter}</p>
                                    <p className="mb-1"><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
                                </div>

                                <table className="w-full text-left mb-6 text-sm border-collapse">
                                    <tbody>
                                        <tr className="border-b">
                                            <td className="py-2">Previous Adjusted Reading</td>
                                            <td className="py-2 text-right">{meter.lastReading}</td>
                                        </tr>
                                        <tr className="border-b">
                                            <td className="py-2">Actual Consumed Units</td>
                                            <td className="py-2 text-right">{result.consumed}</td>
                                        </tr>
                                        <tr className="border-b font-bold text-blue-600">
                                            <td className="py-2">Billed Units (Adjusted)</td>
                                            <td className="py-2 text-right">{result.billedUnits}</td>
                                        </tr>
                                        <tr className="border-b">
                                            <td className="py-2">New Adjusted Reading</td>
                                            <td className="py-2 text-right">{result.newAdjustedReading}</td>
                                        </tr>
                                        <tr className="border-b font-bold text-orange-600">
                                            <td className="py-2">Carry Forward Balance</td>
                                            <td className="py-2 text-right">{result.newCarry} Units</td>
                                        </tr>
                                    </tbody>
                                </table>

                                <div className="text-center text-xs text-gray-500 mt-8">
                                    <p>This is a system generated bill adjustment slip.</p>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-4">
                                <button
                                    onClick={handleSave}
                                    className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-bold transition duration-200"
                                >
                                    ডেটা সেভ করুন
                                </button>
                                <button
                                    onClick={downloadPDF}
                                    className="flex-1 bg-gray-800 text-white py-3 rounded-lg hover:bg-gray-900 font-bold transition duration-200"
                                >
                                    Download PDF
                                </button>
                            </div>

                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}