
import React, { useState, useRef, useEffect } from 'react';
import { GeminiClient } from './services/geminiService';
import { parseMapID, buildKnowledge, extractExercises } from './services/parserService';
import { MapIDItem, ProcessingState, QuestionProcessResult } from './types';
import { StatusBadge } from './components/StatusBadge';

// Removed explicit 'declare global' for aistudio to avoid duplication and modifier mismatch errors 
// as the platform already provides the 'AIStudio' type.

const App: React.FC = () => {
  const [mapContent, setMapContent] = useState<string | null>(null);
  const [texContent, setTexContent] = useState<string | null>(null);
  const [mapFileName, setMapFileName] = useState<string>('');
  const [texFileName, setTexFileName] = useState<string>('');
  const [knowledge, setKnowledge] = useState<MapIDItem[]>([]);
  const [mapSample, setMapSample] = useState<string>('');
  const [useThinking, setUseThinking] = useState(true);
  const [viewMode, setViewMode] = useState<'short' | 'full'>('short');
  const [isMapFromStorage, setIsMapFromStorage] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);

  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    current: 0,
    total: 0,
    results: [],
  });

  const [finalTex, setFinalTex] = useState<string | null>(null);
  const [finalResults, setFinalResults] = useState<QuestionProcessResult[]>([]);

  const stopRef = useRef(false);

  // Kiểm tra trạng thái API Key khi khởi chạy
  useEffect(() => {
    const checkKey = async () => {
      // Access aistudio using type assertion to satisfy TypeScript without conflicting declarations
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const selected = await aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkKey();

    // Nạp MapID từ bộ nhớ
    const savedMapContent = localStorage.getItem('mapper_ai_map_content');
    const savedMapFileName = localStorage.getItem('mapper_ai_map_filename');

    if (savedMapContent && savedMapFileName) {
      try {
        const { mapid } = parseMapID(savedMapContent);
        const { data, summary } = buildKnowledge(mapid);
        if (data.length > 0) {
          setKnowledge(data);
          setMapSample(summary);
          setMapContent(savedMapContent);
          setMapFileName(savedMapFileName);
          setIsMapFromStorage(true);
        }
      } catch (err) {
        console.error("Lỗi nạp MapID từ bộ nhớ:", err);
      }
    }
  }, []);

  const handleOpenKeySelector = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      await aistudio.openSelectKey();
      // Giả định chọn thành công theo hướng dẫn SDK để tránh race condition
      setHasApiKey(true);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'map' | 'tex') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (type === 'map') {
        try {
          const { mapid } = parseMapID(content);
          const { data, summary } = buildKnowledge(mapid);
          if (data.length === 0) {
            alert("Không tìm thấy dữ liệu MapID hợp lệ.");
            return;
          }
          setKnowledge(data);
          setMapSample(summary);
          setMapContent(content);
          setMapFileName(file.name);
          setIsMapFromStorage(false);
          localStorage.setItem('mapper_ai_map_content', content);
          localStorage.setItem('mapper_ai_map_filename', file.name);
        } catch (err) {
          alert("Lỗi khi phân tích tệp MapID.");
        }
      } else {
        setTexContent(content);
        setTexFileName(file.name);
      }
    };
    reader.readAsText(file);
  };

  const clearSavedMap = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Bạn có chắc muốn xóa MapID đã lưu?")) {
      localStorage.removeItem('mapper_ai_map_content');
      localStorage.removeItem('mapper_ai_map_filename');
      setMapContent(null);
      setMapFileName('');
      setKnowledge([]);
      setMapSample('');
      setIsMapFromStorage(false);
    }
  };

  const startProcessing = async () => {
    if (!texContent || !mapSample || knowledge.length === 0) return;
    
    const aistudio = (window as any).aistudio;
    // Yêu cầu chọn API key nếu chưa có
    if (!hasApiKey && aistudio) {
      const confirmKey = window.confirm("Bạn cần cấp quyền API (sử dụng Project GCP cá nhân) để ứng dụng có thể hoạt động. Mở hộp thoại chọn khóa ngay?");
      if (confirmKey) {
        await handleOpenKeySelector();
      } else {
        return;
      }
    }

    stopRef.current = false;
    setFinalTex(null);
    setFinalResults([]);
    
    const exercises = extractExercises(texContent);
    if (exercises.length === 0) {
      alert("Không tìm thấy câu hỏi (ex, bt, vd) nào trong tệp TeX.");
      return;
    }

    setProcessing({
      isProcessing: true,
      current: 0,
      total: exercises.length,
      results: [],
    });

    const client = new GeminiClient();
    let updatedTex = texContent;
    const accumulatedResults: QuestionProcessResult[] = [];

    for (let i = 0; i < exercises.length; i++) {
      if (stopRef.current) break;

      const block = exercises[i];
      const envMatch = block.match(/\\begin\{(ex|bt|vd)\}/);
      const envName = envMatch ? envMatch[1] : 'ex';
      
      const contentMatch = block.match(new RegExp(`\\\\begin\\{${envName}\\}([\\s\\S]*?)\\\\end\\{${envName}\\}`));
      const questionContent = contentMatch ? contentMatch[1].trim() : block;
      
      const previewText = questionContent.slice(0, 1000); 

      try {
        const aiResult = await client.analyze(previewText, mapSample, knowledge, useThinking);
        const code = `[${aiResult.lop}${aiResult.mon}${aiResult.chuong}${aiResult.muc_do}${aiResult.bai}-${aiResult.dang}]`;
        
        const res: QuestionProcessResult = {
          index: i + 1,
          questionPreview: questionContent,
          idCode: code,
          status: aiResult.is_valid ? 'valid' : 'warning',
          confidence: `${Math.round(aiResult.do_tin_cay * 100)}%`,
          level: aiResult.muc_do,
          fullBlock: block
        };

        const newBlock = block.replace(`\\begin{${envName}}`, `\\begin{${envName}}%${code}`);
        updatedTex = updatedTex.replace(block, newBlock);
        
        accumulatedResults.push(res);
        setProcessing(prev => ({
          ...prev,
          current: i + 1,
          results: [res, ...prev.results]
        }));
      } catch (err: any) {
        // Xử lý lỗi API Key không hợp lệ
        if (err.message === "API_KEY_INVALID") {
          alert("Lỗi: API Key hoặc Project GCP không tìm thấy. Vui lòng chọn lại API Key.");
          setHasApiKey(false);
          stopRef.current = true;
          break;
        }

        const res: QuestionProcessResult = {
          index: i + 1,
          questionPreview: questionContent,
          idCode: '[LỖI]',
          status: 'error',
          confidence: '0%',
          level: 'N/A',
          fullBlock: block,
          errorMessage: err.message
        };
        accumulatedResults.push(res);
        setProcessing(prev => ({
          ...prev,
          current: i + 1,
          results: [res, ...prev.results]
        }));
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!stopRef.current) {
      setFinalTex(updatedTex);
      setFinalResults(accumulatedResults);
    }
    setProcessing(prev => ({ ...prev, isProcessing: false }));
  };

  const downloadResults = () => {
    if (!finalTex) return;

    const texBlob = new Blob([finalTex], { type: 'text/plain' });
    const texUrl = URL.createObjectURL(texBlob);
    const texLink = document.createElement('a');
    texLink.href = texUrl;
    texLink.download = texFileName.replace('.tex', '_DaGanID.tex');
    texLink.click();
    URL.revokeObjectURL(texUrl);

    const csvContent = "\uFEFFSTT,Noi dung,ID,Trang thai,Muc do,Do tin cay\n" + 
      finalResults.map(r => `${r.index},"${r.questionPreview.replace(/"/g, '""')}",${r.idCode},${r.status},${r.level},${r.confidence}`).join('\n');
    const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvLink = document.createElement('a');
    csvLink.href = csvUrl;
    csvLink.download = texFileName.replace('.tex', '_BaoCao.csv');
    csvLink.click();
    URL.revokeObjectURL(csvUrl);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-indigo-100 pb-20 font-sans leading-relaxed">
      <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-600 h-2"></div>

      <div className="max-w-7xl mx-auto px-4 py-8 md:px-8">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* SIDEBAR */}
          <aside className="w-full lg:w-80 flex-shrink-0 space-y-6">
            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 p-6 sticky top-8 overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-blue-500"></div>
              
              <h1 className="text-2xl font-black flex items-center gap-2 mb-1 tracking-tight">
                <span className="text-transparent bg-clip-text bg-gradient-to-br from-indigo-600 to-blue-600">🎯 Mapper AI</span>
              </h1>
              <p className="text-[10px] text-slate-400 mb-8 uppercase tracking-[0.2em] font-bold">Smart ID Tagger (EX/BT/VD)</p>

              <div className="space-y-6">
                {/* API Key Configuration Section */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 transition-all hover:bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                      🔑 Quyền truy cập API
                    </span>
                    <span className={`w-2 h-2 rounded-full ${hasApiKey ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse'}`}></span>
                  </div>
                  
                  <div className="space-y-3">
                    <button 
                      onClick={handleOpenKeySelector}
                      className={`w-full py-2.5 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-2 ${
                        hasApiKey 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                        : 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:-translate-y-0.5'
                      }`}
                    >
                      {hasApiKey ? '✅ ĐÃ CẤP QUYỀN API' : '⚡ CẤP QUYỀN API (GCP)'}
                    </button>
                    <p className="text-[9px] text-slate-400 leading-tight italic">
                      Bạn cần dùng Project GCP đã bật <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-indigo-500 underline font-bold">Thanh toán</a> để hoạt động.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50 transition-all hover:bg-indigo-50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-indigo-900 uppercase tracking-tighter flex items-center gap-1.5">
                      🧠 Chế độ suy nghĩ
                    </span>
                    <button 
                      onClick={() => setUseThinking(!useThinking)}
                      className={`w-12 h-6 rounded-full transition-all relative ${useThinking ? 'bg-indigo-600 shadow-lg shadow-indigo-200' : 'bg-slate-300'}`}
                    >
                      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${useThinking ? 'translate-x-6' : ''}`}></div>
                    </button>
                  </div>
                  <p className="text-[10px] text-indigo-400 font-medium italic">Gemini 3 Flash-Preview</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">📁 Tệp tin đầu vào</span>
                  </div>
                  
                  <div className="relative group">
                    <label className="block cursor-pointer">
                      <input type="file" accept=".tex,.txt" onChange={(e) => handleFileChange(e, 'map')} className="hidden" />
                      <div className={`px-4 py-4 rounded-2xl border-2 border-dashed transition-all flex items-center gap-4 ${
                        mapFileName ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                      }`}>
                        <div className={`p-2 rounded-xl transition-colors ${mapFileName ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <div className="min-w-0 pr-6">
                          <p className="text-[11px] font-black truncate">{mapFileName || 'MapID Structure (.tex)'}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-[9px] opacity-60 font-bold">{mapFileName ? `✅ Đã nạp ${knowledge.length} mã` : 'Nạp cấu trúc cây ID'}</p>
                            {isMapFromStorage && (
                              <span className="bg-amber-100 text-amber-700 text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">💾 Đã lưu</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </label>
                    {mapFileName && (
                      <button 
                        onClick={clearSavedMap}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Xóa MapID đã lưu"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </div>

                  <label className="block cursor-pointer">
                    <input type="file" accept=".tex" onChange={(e) => handleFileChange(e, 'tex')} className="hidden" />
                    <div className={`px-4 py-4 rounded-2xl border-2 border-dashed transition-all flex items-center gap-4 ${
                      texFileName ? 'border-indigo-200 bg-indigo-50/50 text-indigo-700' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                    }`}>
                      <div className={`p-2 rounded-xl transition-colors ${texFileName ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black truncate">{texFileName || 'Source Questions (.tex)'}</p>
                        <p className="text-[9px] opacity-60 font-bold">Hỗ trợ \begin{"{ex, bt, vd}"}</p>
                      </div>
                    </div>
                  </label>
                </div>

                <div className="pt-4 space-y-3">
                  <button
                    onClick={startProcessing}
                    disabled={processing.isProcessing || !texContent || !mapContent}
                    className={`group w-full py-4 rounded-2xl font-black text-sm shadow-xl transition-all relative overflow-hidden ${
                      processing.isProcessing || !texContent || !mapContent
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'
                        : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:shadow-indigo-200 hover:-translate-y-0.5 active:translate-y-0'
                    }`}
                  >
                    <div className="relative z-10 flex items-center justify-center gap-2">
                      {processing.isProcessing ? (
                        <>
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          <span>ĐANG XỬ LÝ...</span>
                        </>
                      ) : (
                        <>🚀 BẮT ĐẦU GÁN ID</>
                      )}
                    </div>
                  </button>

                  {processing.isProcessing && (
                    <button
                      onClick={() => (stopRef.current = true)}
                      className="w-full py-3 text-rose-500 text-[11px] font-black hover:bg-rose-50 rounded-xl transition-colors uppercase tracking-widest border border-rose-100"
                    >
                      ⏹️ DỪNG LẠI
                    </button>
                  )}

                  {finalTex && !processing.isProcessing && (
                    <button
                      onClick={downloadResults}
                      className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl font-black text-sm shadow-xl hover:shadow-emerald-200 transition-all hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
                    >
                      💾 LƯU KẾT QUẢ
                    </button>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* MAIN CONTENT AREA */}
          <main className="flex-1 min-w-0 space-y-6">
            {/* PROGRESS CARD */}
            {processing.total > 0 && (
              <div className="bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4">
                  <div className="flex items-center gap-2 bg-rose-50 px-3 py-1 rounded-full border border-rose-100">
                    <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
                    <span className="text-[9px] font-black text-rose-600 uppercase tracking-tighter">Live Status</span>
                  </div>
                </div>
                
                <div className="flex items-end justify-between mb-6">
                  <div>
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                      📊 Tiến trình hệ thống
                    </h2>
                    <p className="text-4xl font-black text-slate-900 tracking-tighter">
                      {processing.current} <span className="text-slate-200">/</span> {processing.total}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-2xl text-xs font-black shadow-lg shadow-indigo-100">
                      {Math.round((processing.current / processing.total) * 100)}%
                    </div>
                  </div>
                </div>
                
                <div className="w-full bg-slate-100 rounded-2xl h-6 overflow-hidden p-1.5 shadow-inner border border-slate-200/50">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-600 via-blue-500 to-emerald-500 transition-all duration-700 ease-out rounded-xl relative shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                    style={{ width: `${(processing.current / processing.total) * 100}%` }}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:20px_20px] animate-[shimmer_1s_linear_infinite]"></div>
                  </div>
                </div>
              </div>
            )}

            {/* ACTIVITY LOG CARD */}
            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 overflow-hidden flex flex-col">
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600 border border-indigo-100 shadow-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">Hoạt động gán mã</h2>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Thời gian thực</p>
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                      <th className="px-6 py-4 w-16 text-center">STT</th>
                      <th className="px-4 py-4">
                        <div className="flex items-center justify-between">
                          <span>📝 Nội dung TeX</span>
                          <button 
                            onClick={() => setViewMode(viewMode === 'short' ? 'full' : 'short')}
                            className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-200 transition-colors flex items-center gap-1 normal-case font-bold"
                          >
                            <span>{viewMode === 'short' ? '👁️ Xem đầy đủ' : '🔭 Rút gọn'}</span>
                          </button>
                        </div>
                      </th>
                      <th className="px-4 py-4 w-44 text-center">🏷️ Mã ID</th>
                      <th className="px-4 py-4 w-32 text-center">🔔 Trạng thái</th>
                      <th className="px-4 py-4 w-24 text-center">📉 Mức độ</th>
                      <th className="px-8 py-4 w-40">📈 Tin cậy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {processing.results.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-8 py-24 text-center">
                          <div className="flex flex-col items-center gap-4 opacity-30 grayscale">
                            <div className="p-6 bg-slate-100 rounded-full mb-2">
                              <svg className="w-16 h-16 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                            </div>
                            <p className="text-sm font-black text-slate-400 uppercase tracking-widest italic">Chưa có dữ liệu xử lý</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      processing.results.map((res) => {
                        const envTagMatch = res.fullBlock.match(/\\begin\{(ex|bt|vd)\}/);
                        const envTag = envTagMatch ? envTagMatch[1].toUpperCase() : 'EX';
                        
                        return (
                          <tr key={res.index} className="group hover:bg-indigo-50/20 transition-all duration-300">
                            <td className="px-6 py-6 text-xs font-black text-slate-300 group-hover:text-indigo-600 transition-colors text-center font-mono">{res.index}</td>
                            <td className="px-4 py-6 min-w-[320px]">
                              <div className={`rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-xl transition-all group-hover:border-indigo-200 overflow-hidden relative ${
                                viewMode === 'short' ? 'max-h-32' : 'max-h-[500px] overflow-y-auto'
                              }`}>
                                <div className="absolute top-2 right-2 px-2 py-0.5 bg-indigo-600 text-[8px] font-black text-white rounded uppercase tracking-tighter shadow-lg z-10">
                                  {envTag}
                                </div>
                                <pre className="text-[11px] font-mono text-indigo-100/90 whitespace-pre-wrap break-all leading-relaxed">
                                  {res.fullBlock}
                                </pre>
                                {viewMode === 'short' && (
                                  <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none"></div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-6">
                              <div className={`px-3 py-2 rounded-xl border-2 font-black text-[11px] text-center shadow-sm flex flex-col gap-1 transition-all ${
                                res.status === 'error' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100 group-hover:scale-105 group-hover:bg-white'
                              }`}>
                                <span className="text-[8px] opacity-50 uppercase tracking-tighter">Assigned ID</span>
                                {res.idCode}
                              </div>
                            </td>
                            <td className="px-4 py-6 text-center">
                              <StatusBadge status={res.status} label={res.status === 'valid' ? 'Xác thực' : res.status === 'error' ? 'Lỗi' : 'Dự đoán'} />
                            </td>
                            <td className="px-4 py-6 text-center">
                              <span className="text-[11px] font-black text-white bg-slate-800 px-3 py-1 rounded-lg border border-slate-700 shadow-sm">{res.level}</span>
                            </td>
                            <td className="px-8 py-6">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-black text-slate-500 tabular-nums">{res.confidence}</span>
                                  <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">Confidence</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full min-w-[80px] overflow-hidden p-0.5 border border-slate-200/50 shadow-inner">
                                  <div 
                                    className={`h-full transition-all duration-1000 rounded-full ${
                                      parseInt(res.confidence) > 85 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 
                                      parseInt(res.confidence) > 60 ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : 'bg-gradient-to-r from-amber-500 to-orange-400'
                                    }`} 
                                    style={{ width: res.confidence }}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 0% 0%; }
          100% { background-position: 40px 0%; }
        }
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #f8fafc;
        }
        ::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
};

export default App;
