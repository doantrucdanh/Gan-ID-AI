
import React, { useState, useRef, useEffect } from 'react';
import { GeminiClient } from './services/geminiService';
import { parseMapID, buildKnowledge, extractExercisesWithPositions } from './services/parserService';
import { MapIDItem, ProcessingState, QuestionProcessResult } from './types';
import { StatusBadge } from './components/StatusBadge';

const App: React.FC = () => {
  const [mapContent, setMapContent] = useState<string | null>(null);
  const [texContent, setTexContent] = useState<string | null>(null);
  const [mapFileName, setMapFileName] = useState<string>('');
  const [texFileName, setTexFileName] = useState<string>('');
  const [knowledge, setKnowledge] = useState<MapIDItem[]>([]);
  const [mapSample, setMapSample] = useState<string>('');
  const [useThinking, setUseThinking] = useState(false);
  const [viewMode, setViewMode] = useState<'short' | 'full'>('short');
  
  const [apiKey, setApiKey] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [tempKey, setTempKey] = useState<string>('');

  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    current: 0,
    total: 0,
    results: [],
  });

  const [finalTex, setFinalTex] = useState<string | null>(null);
  const [finalResults, setFinalResults] = useState<QuestionProcessResult[]>([]);

  const stopRef = useRef(false);

  // Load data on startup
  useEffect(() => {
    // 1. Load API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setTempKey(savedKey);
    }

    // 2. Load MapID persistence
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
        }
      } catch (err) {
        console.error("Lỗi nạp MapID từ bộ nhớ tạm:", err);
      }
    }
  }, []);

  const handleSaveKey = () => {
    if (!tempKey.trim()) {
      alert("Vui lòng nhập API Key!");
      return;
    }
    localStorage.setItem('gemini_api_key', tempKey.trim());
    setApiKey(tempKey.trim());
    setShowKeyModal(false);
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
          
          // Save to localStorage for persistence
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

  const cancelProcessing = () => {
    stopRef.current = true;
  };

  const startProcessing = async () => {
    if (!texContent || !mapSample || knowledge.length === 0) {
      alert("Vui lòng tải đủ tệp MapID và tệp TeX câu hỏi!");
      return;
    }
    
    if (!apiKey) {
      setShowKeyModal(true);
      return;
    }

    stopRef.current = false;
    setFinalTex(null);
    setFinalResults([]);
    
    const matches = extractExercisesWithPositions(texContent);
    if (matches.length === 0) {
      alert("Không tìm thấy câu hỏi (ex, bt, vd) nào trong tệp TeX.");
      return;
    }

    setProcessing({
      isProcessing: true,
      current: 0,
      total: matches.length,
      results: [],
    });

    const client = new GeminiClient();
    const accumulatedResults: (QuestionProcessResult & { start: number; end: number })[] = [];

    for (let i = 0; i < matches.length; i++) {
      if (stopRef.current) break;

      const { block, env, startIndex, endIndex } = matches[i];
      const innerContentMatch = block.match(new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`));
      const questionContent = innerContentMatch ? innerContentMatch[1].trim() : block;
      
      try {
        const aiResult = await client.analyze(questionContent.slice(0, 3000), mapSample, knowledge, useThinking);
        
        const code = `[${aiResult.lop}${aiResult.mon}${aiResult.chuong}${aiResult.muc_do}${aiResult.bai}-${aiResult.dang}]`;
        
        const res: QuestionProcessResult & { start: number; end: number } = {
          index: i + 1,
          questionPreview: questionContent,
          idCode: code,
          status: aiResult.is_valid ? 'valid' : 'warning',
          confidence: `${Math.round(aiResult.do_tin_cay * 100)}%`,
          level: aiResult.muc_do,
          fullBlock: block,
          start: startIndex,
          end: endIndex
        };

        accumulatedResults.push(res);
        setProcessing(prev => ({ ...prev, current: i + 1, results: [res, ...prev.results] }));
      } catch (err: any) {
        let msg = "Lỗi hệ thống";
        if (err.message === "API_KEY_INVALID") msg = "API Key không hợp lệ.";
        else if (err.message === "QUOTA_EXCEEDED") msg = "Hết hạn mức API.";
        
        alert(`Dừng xử lý: ${msg}`);
        stopRef.current = true;
        break;
      }
      
      if (!stopRef.current) {
        await new Promise(r => setTimeout(r, 600));
      }
    }

    let newTex = "";
    let lastPos = 0;
    const sortedResults = [...accumulatedResults].sort((a, b) => a.start - b.start);
    
    sortedResults.forEach(res => {
      newTex += texContent.substring(lastPos, res.start);
      const envName = res.fullBlock.match(/\\begin\{(ex|bt|vd)\}/)?.[1] || 'ex';
      const modifiedBlock = res.fullBlock.replace(`\\begin{${envName}}`, `\\begin{${envName}}%${res.idCode}`);
      newTex += modifiedBlock;
      lastPos = res.end;
    });
    newTex += texContent.substring(lastPos);

    setFinalTex(newTex);
    setFinalResults(sortedResults);
    setProcessing(prev => ({ ...prev, isProcessing: false }));
  };

  const downloadResults = () => {
    if (!finalTex) return;
    const texBlob = new Blob([finalTex], { type: 'text/plain' });
    const texLink = document.createElement('a');
    texLink.href = URL.createObjectURL(texBlob);
    texLink.download = texFileName.replace('.tex', '_DaGanID.tex');
    texLink.click();

    const csvContent = "\uFEFFSTT,Noi dung,ID,Trang thai,Muc do,Do tin cay\n" + 
      finalResults.map(r => `${r.index},"${r.questionPreview.replace(/"/g, '""').replace(/\n/g, ' ')}",${r.idCode},${r.status},${r.level},${r.confidence}`).join('\n');
    const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvLink = document.createElement('a');
    csvLink.href = URL.createObjectURL(csvBlob);
    csvLink.download = texFileName.replace('.tex', '_BaoCao.csv');
    csvLink.click();
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      <div className="bg-indigo-600 h-1 w-full flex-shrink-0"></div>
      
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-full lg:w-80 flex-shrink-0 bg-white border-r border-slate-200 p-6 flex flex-col gap-6 overflow-y-auto">
          <div>
            <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent tracking-tight">🎯 Mapper AI</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Auto Math ID Tagger</p>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center justify-between">
                🔑 Cấu hình API Key
                <span className={`text-[8px] px-1.5 py-0.5 rounded-md ${apiKey ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {apiKey ? 'ĐÃ LƯU' : 'CHƯA CÓ'}
                </span>
              </label>
              <button 
                onClick={() => setShowKeyModal(true)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm flex items-center justify-between hover:border-indigo-300 transition-all"
              >
                <span className="text-slate-400 truncate mr-2">
                  {apiKey ? '••••••••••••••••••••' : 'Nhấn để nhập API Key...'}
                </span>
                <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">📂 1. Tệp MapID</label>
                <label className="block cursor-pointer">
                  <input type="file" accept=".tex,.txt" onChange={(e) => handleFileChange(e, 'map')} className="hidden" />
                  <div className={`p-3 rounded-xl border border-dashed transition-all flex items-center gap-3 ${
                    mapFileName ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'
                  }`}>
                    <span className="text-base">{mapFileName ? '✅' : '📁'}</span>
                    <p className="text-[11px] font-bold truncate flex-1">{mapFileName || 'Chọn file .tex'}</p>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">📄 2. Tệp Câu hỏi</label>
                <label className="block cursor-pointer">
                  <input type="file" accept=".tex" onChange={(e) => handleFileChange(e, 'tex')} className="hidden" />
                  <div className={`p-3 rounded-xl border border-dashed transition-all flex items-center gap-3 ${
                    texFileName ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'
                  }`}>
                    <span className="text-base">{texFileName ? '✅' : '📝'}</span>
                    <p className="text-[11px] font-bold truncate flex-1">{texFileName || 'Chọn file .tex'}</p>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-2 space-y-3">
              {!processing.isProcessing ? (
                <button
                  onClick={startProcessing}
                  disabled={!texContent || !mapContent}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all shadow-md shadow-indigo-100"
                >
                  🚀 CHẠY GÁN ID
                </button>
              ) : (
                <button
                  onClick={cancelProcessing}
                  className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  DỪNG GÁN ID
                </button>
              )}

              {finalTex && !processing.isProcessing && (
                <button
                  onClick={downloadResults}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-sm transition-all shadow-md shadow-emerald-100"
                >
                  💾 TẢI FILE KẾT QUẢ
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-h-0 bg-slate-50">
          
          {/* Progress Banner */}
          {processing.total > 0 && (
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tiến độ xử lý</span>
                    <span className="text-xs font-black text-indigo-600">{processing.current} / {processing.total} ({Math.round((processing.current / processing.total) * 100)}%)</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-600 transition-all duration-300 ease-out" 
                      style={{ width: `${(processing.current / processing.total) * 100}%` }} 
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Table Container */}
          <div className="flex-1 flex flex-col min-h-0 m-6 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 flex-shrink-0">
              <h2 className="font-black text-xs uppercase tracking-widest text-slate-500">Danh sách câu hỏi</h2>
              <button 
                onClick={() => setViewMode(viewMode === 'short' ? 'full' : 'short')} 
                className="text-[10px] font-black text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-full transition-colors"
              >
                {viewMode === 'short' ? '👁️ XEM ĐẦY ĐỦ' : '🔭 THU GỌN'}
              </button>
            </div>
            
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left table-fixed border-collapse">
                <thead className="sticky top-0 z-10 text-[10px] font-black text-slate-400 uppercase bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 w-16 text-center">STT</th>
                    <th className="px-6 py-3 min-w-[300px]">Nội dung câu hỏi</th>
                    <th className="px-6 py-3 w-40 text-center">ID Gán</th>
                    <th className="px-6 py-3 w-32 text-center">Độ tin cậy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {processing.results.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-24 text-center text-slate-300 italic font-bold">
                        {processing.isProcessing ? 'Đang phân tích câu hỏi...' : 'Chưa có dữ liệu. Vui lòng tải file và chạy gán ID.'}
                      </td>
                    </tr>
                  ) : (
                    processing.results.map((res) => (
                      <tr key={res.index} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-black text-slate-400 text-center align-top">{res.index}</td>
                        <td className="px-6 py-4 align-top">
                          <div className={`rounded-xl bg-slate-900 p-3 font-mono text-[11px] text-indigo-100/80 border border-slate-800 overflow-y-auto ${viewMode === 'short' ? 'max-h-32' : 'max-h-96'}`}>
                            <pre className="whitespace-pre-wrap leading-relaxed">{res.fullBlock}</pre>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col items-center gap-2">
                            <span className="w-full font-black text-[11px] text-indigo-700 bg-indigo-50 px-2 py-2 rounded-lg border border-indigo-100 text-center">
                              {res.idCode}
                            </span>
                            <StatusBadge status={res.status} label={res.status === 'valid' ? 'Khớp mã' : 'Dự đoán'} />
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col items-center gap-1.5 pt-1">
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500" style={{ width: res.confidence }} />
                            </div>
                            <span className="text-[10px] font-black text-slate-500">{res.confidence}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* Modal API Key */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between text-white">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                Cấu hình API Key
              </h2>
              <button onClick={() => setShowKeyModal(false)} className="hover:bg-white/10 p-1.5 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <p className="text-slate-500 text-xs">
                  Nhập Gemini API Key để bắt đầu. Khóa được lưu cục bộ trên trình duyệt của bạn.
                </p>
                <input 
                  type="password"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  placeholder="Nhập API Key tại đây..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleSaveKey}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all"
                >
                  Lưu cấu hình
                </button>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-center text-indigo-600 text-[11px] font-medium hover:underline"
                >
                  Chưa có key? Lấy mã Gemini API tại đây
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
