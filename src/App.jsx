import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  UploadCloud, 
  FolderOpen, 
  FileCode, 
  Trash2, 
  Eye, 
  X, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  Download, 
  FileJson,
  RotateCw,
  Copy,
  File
} from 'lucide-react';

// --- Worker Code as Constant ---
const WORKER_CODE = `
importScripts('https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js');

self.onmessage = function(e) {
    const { content, filename, id, options } = e.data;
    
    try {
        const output = Babel.transform(content, options || {
            filename: filename,
            presets: [
                ['env', { targets: { esmodules: true }, modules: false }],
                'react',
                'typescript'
            ],
            sourceMaps: false
        }).code;

        self.postMessage({ success: true, id, content: output });
    } catch (error) {
        const cleanError = error.message.replace(filename + ': ', '');
        self.postMessage({ success: false, id, error: cleanError });
    }
};
`;

const App = () => {
  // --- State ---
  const [files, setFiles] = useState([]);
  const [uploadMode, setUploadMode] = useState('file'); // 'file' | 'folder'
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [previewFile, setPreviewFile] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [scriptsLoaded, setScriptsLoaded] = useState(false);

  // --- Refs for Mutable Logic ---
  const workersRef = useRef([]);
  const queueRef = useRef([]);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // --- Initialization ---

  // Load External Scripts (Babel/JSZip are large, loading from CDN)
  useEffect(() => {
    const loadScript = (src) => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

    Promise.all([
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js')
    ]).then(() => setScriptsLoaded(true))
      .catch(() => showToast('Failed to load required libraries', 'error'));

    return () => terminateWorkers();
  }, []);

  // Initialize Workers
  const initWorkers = useCallback(() => {
    if (workersRef.current.length > 0) return;

    const blob = new Blob([WORKER_CODE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const concurrency = navigator.hardwareConcurrency || 4;

    for (let i = 0; i < concurrency; i++) {
      const w = new Worker(url);
      w.onmessage = handleWorkerMessage;
      workersRef.current.push({ worker: w, busy: false, id: i });
    }
  }, []);

  const terminateWorkers = () => {
    workersRef.current.forEach(w => w.worker.terminate());
    workersRef.current = [];
    setActiveWorkers(0);
  };

  // --- Worker Logic ---

  const handleWorkerMessage = (e) => {
    const { id, success, content, error } = e.data;

    setFiles(prev => prev.map(f => {
      if (f.id === id) {
        return { 
          ...f, 
          content: success ? content : null, 
          error: success ? null : error, 
          status: 'complete' 
        };
      }
      return f;
    }));

    // Free up worker
    const workerObj = workersRef.current.find(w => w.busy && w.currentId === id);
    if (workerObj) {
      workerObj.busy = false;
      workerObj.currentId = null;
      setActiveWorkers(prev => prev - 1);
    }

    setProgress(prev => ({ ...prev, current: prev.current + 1 }));
    processQueue();
  };

  const processQueue = () => {
    if (queueRef.current.length === 0) {
      if (workersRef.current.every(w => !w.busy)) {
        setIsProcessing(false);
      }
      return;
    }

    const freeWorker = workersRef.current.find(w => !w.busy);
    if (freeWorker) {
      const task = queueRef.current.shift();
      freeWorker.busy = true;
      freeWorker.currentId = task.id;
      setActiveWorkers(prev => prev + 1);

      freeWorker.worker.postMessage({
        content: task.content,
        filename: task.filename,
        id: task.id
      });
      
      // Try to assign next task to another free worker
      processQueue();
    }
  };

  // --- File Handling ---

  const handleFiles = useCallback((fileList) => {
    if (!fileList || fileList.length === 0) return;
    
    // Ensure workers exist
    if (workersRef.current.length === 0) initWorkers();

    const validFiles = Array.from(fileList).filter(f => 
      f.name.match(/\.(ts|tsx|jsx|js)$/) && !f.name.includes('.d.ts')
    );

    if (validFiles.length === 0) {
      showToast('No valid TS/JS files found', 'error');
      return;
    }

    // Chunked reading to prevent UI freeze
    let readIndex = 0;
    const CHUNK_SIZE = 20;

    const readNextChunk = () => {
      const chunk = validFiles.slice(readIndex, readIndex + CHUNK_SIZE);
      
      chunk.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const path = file.webkitRelativePath || file.name;
            
            let newName = file.name;
            let newPath = path;
            
            if (file.name.endsWith('.ts')) { newName = file.name.replace('.ts', '.js'); newPath = path.replace(/\.ts$/, '.js'); }
            else if (file.name.endsWith('.tsx')) { newName = file.name.replace('.tsx', '.js'); newPath = path.replace(/\.tsx$/, '.js'); }
            else if (file.name.endsWith('.jsx')) { newName = file.name.replace('.jsx', '.js'); newPath = path.replace(/\.jsx$/, '.js'); }

            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            
            // Add to UI state with 'idle' status and store inputContent
            setFiles(prev => [...prev, {
                id,
                originalName: file.name,
                newName,
                originalPath: path,
                newPath,
                inputContent: content, // Store source for later processing
                content: null,
                status: 'idle',
                error: null
            }]);
        };
        reader.readAsText(file);
      });

      readIndex += CHUNK_SIZE;
      if (readIndex < validFiles.length) {
        setTimeout(readNextChunk, 50);
      }
    };

    readNextChunk();
  }, [initWorkers]);

  const handleConvert = () => {
    const idleFiles = files.filter(f => f.status === 'idle');
    if (idleFiles.length === 0) return;

    setIsProcessing(true);
    // Reset or add to progress
    setProgress(prev => ({ 
      current: prev.current, 
      total: prev.total + idleFiles.length 
    }));

    // Add to queue
    idleFiles.forEach(f => {
      queueRef.current.push({ 
        id: f.id, 
        content: f.inputContent, 
        filename: f.originalName 
      });
    });

    // Update status in UI
    setFiles(prev => prev.map(f => f.status === 'idle' ? { ...f, status: 'pending' } : f));

    // Start
    processQueue();
  };

  // --- Actions ---

  const handleDownloadZip = async () => {
    if (!window.JSZip) return;
    
    const zip = new window.JSZip();
    let addedCount = 0;

    files.forEach(file => {
      if (!file.error && file.content) {
        zip.file(file.newPath, file.content);
        addedCount++;
      }
    });

    if (addedCount === 0) {
      showToast('No valid files to zip', 'error');
      return;
    }

    const blob = await zip.generateAsync({type: "blob"});
    window.saveAs(blob, "converted_project.zip");
    showToast('Download started!');
  };

  const handleClear = () => {
    // Terminate pending work
    queueRef.current = [];
    terminateWorkers(); 
    initWorkers(); // Restart fresh
    setFiles([]);
    setProgress({ current: 0, total: 0 });
    setIsProcessing(false);
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  // --- UI Helpers ---

  const showToast = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  };

  const getProgressPercentage = () => {
    if (progress.total === 0) return 0;
    return Math.round((progress.current / progress.total) * 100);
  };
  
  // Counts
  const idleCount = files.filter(f => f.status === 'idle').length;
  const processedCount = files.filter(f => f.status === 'complete').length;

  // --- Render Components ---

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gradient-to-br from-slate-900 to-teal-950 text-slate-200">
      
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-900/80 sticky top-0 z-50 backdrop-blur-md">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20">
                TS
              </div>
              <span className="font-bold text-xl tracking-tight text-white">Transpile<span className="text-blue-400">Box</span></span>
            </div>
            {/* Hidden on small screens */}
            <div className="hidden sm:block text-xs font-mono text-slate-500 border border-slate-800 rounded px-2 py-1">
              v3.5 Refined UI
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-grow">
        <div className="max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-8 h-full">
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              TypeScript to JavaScript
            </h1>
            <p className="text-slate-400 text-base md:text-lg max-w-2xl mx-auto">
              Client-side transpilation powered by Web Workers. <br className="hidden md:inline" />
              Drag, drop, and convert entire projects instantly.
            </p>
          </div>

          {/* Main Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Left Column - Controls (4 columns on lg+) */}
            <div className="lg:col-span-3 flex flex-col gap-6">
              
              {/* Drop Zone */}
              <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl h-full">
                <div className="flex items-center gap-2 mb-4">
                  <UploadCloud className="text-blue-400 w-5 h-5" />
                  <h2 className="text-white font-semibold">Import</h2>
                </div>

                <div 
                  onClick={() => uploadMode === 'file' ? fileInputRef.current?.click() : folderInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500', 'bg-slate-800'); }}
                  onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-500', 'bg-slate-800'); }}
                  onDrop={(e) => { 
                    e.preventDefault(); 
                    e.currentTarget.classList.remove('border-blue-500', 'bg-slate-800');
                    handleFiles(e.dataTransfer.files);
                  }}
                  className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl bg-slate-800/30 transition-all duration-300 flex flex-col items-center justify-center py-10 px-4 cursor-pointer text-center group"
                >
                  {/* Mode Toggle */}
                  <div 
                    className="bg-slate-900/50 rounded-full p-1 border border-slate-600/50 mb-6 flex gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button 
                      onClick={() => setUploadMode('file')}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${uploadMode === 'file' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
                    >
                      <File className="w-3.5 h-3.5" /> Files
                    </button>
                    <button 
                      onClick={() => setUploadMode('folder')}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${uploadMode === 'folder' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Folder
                    </button>
                  </div>

                  <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                    {uploadMode === 'file' ? (
                      <FileCode className="w-8 h-8 text-slate-400 group-hover:text-blue-400" />
                    ) : (
                      <FolderOpen className="w-8 h-8 text-slate-400 group-hover:text-blue-400" />
                    )}
                  </div>
                  <p className="text-slate-300 font-medium mb-2 text-lg">Click or Drag & Drop</p>
                  <p className="text-slate-500 text-sm">
                    {uploadMode === 'file' ? 'Select .ts/.tsx/.jsx files' : 'Select project folder'}
                  </p>
                  
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    multiple 
                    accept=".ts,.tsx,.jsx,.js" 
                    onChange={(e) => handleFiles(e.target.files)} 
                  />
                  <input 
                    type="file" 
                    ref={folderInputRef} 
                    className="hidden" 
                    webkitdirectory="" 
                    directory="" 
                    multiple 
                    onChange={(e) => handleFiles(e.target.files)} 
                  />
                </div>
              </div>

              {/* Conversion Action Panel */}
              {idleCount > 0 && !isProcessing && (
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-300 font-medium">Ready to convert</span>
                    <span className="bg-blue-900/50 text-blue-300 px-3 py-1 rounded text-sm font-medium">{idleCount} files</span>
                  </div>
                  <button 
                    onClick={handleConvert}
                    className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <RotateCw className="w-5 h-5" /> Start Conversion
                  </button>
                </div>
              )}

              {/* Progress Panel */}
              {(isProcessing || (progress.total > 0 && idleCount === 0)) && (
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
                      {isProcessing ? 'Processing...' : 'Complete'}
                    </h3>
                    <span className="text-sm font-medium text-blue-300">{getProgressPercentage()}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden mb-4">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${getProgressPercentage()}%` }}
                    ></div>
                  </div>
                  {isProcessing && (
                    <button onClick={handleClear} className="text-sm text-red-400 hover:text-red-300 font-medium">
                      Cancel Operation
                    </button>
                  )}
                </div>
              )}

              {/* Summary Panel */}
              {processedCount > 0 && !isProcessing && idleCount === 0 && (
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl">
                  <h3 className="text-sm uppercase tracking-wider text-slate-500 font-bold mb-5">Summary</h3>
                  
                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300">Files Processed</span>
                      <span className="text-white font-bold text-lg">{processedCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300">Errors</span>
                      <span className={files.some(f => f.error) ? "text-red-400 font-bold text-lg" : "text-emerald-400 font-bold text-lg"}>
                        {files.filter(f => f.error).length}
                      </span>
                    </div>
                  </div>

                  <button 
                    onClick={handleDownloadZip}
                    className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Download className="w-5 h-5" /> Download All (.zip)
                  </button>
                </div>
              )}
            </div>

            {/* Right Column - Output (8 columns on lg+, 9 columns on xl+) */}
            <div className="lg:col-span-9 flex flex-col h-full">
              <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl shadow-xl flex flex-col h-full min-h-[600px]">
                {/* Output Header */}
                <div className="p-5 border-b border-slate-700 flex flex-wrap justify-between items-center bg-slate-800/50 gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                      <FileCode className="text-indigo-400 w-5 h-5" /> Output
                    </h2>
                    {activeWorkers > 0 && (
                      <span className="text-xs px-3 py-1 rounded-full bg-blue-900/30 text-blue-300 flex items-center gap-2">
                        <RotateCw className="w-3 h-3 animate-spin" /> Workers Active: {activeWorkers}
                      </span>
                    )}
                  </div>
                  {files.length > 0 && (
                    <button 
                      onClick={handleClear} 
                      className="text-sm text-red-400 hover:text-red-300 transition-colors flex items-center gap-2 hover:bg-red-900/20 px-3 py-1.5 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" /> Clear All
                    </button>
                  )}
                </div>

                {/* List Content */}
                <div className="flex-grow overflow-y-auto p-5">
                  {files.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center px-4 py-16">
                      <FileJson className="w-16 h-16 mb-6 opacity-50" />
                      <p className="font-medium text-lg mb-2">Ready for code.</p>
                      <p className="text-sm text-slate-500">Multithreaded processing enabled.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {files.map((file) => (
                        <div 
                          key={file.id}
                          className={`bg-slate-800 rounded-xl p-4 flex items-center justify-between border transition-all duration-300 group hover:shadow-lg hover:-translate-y-0.5 ${file.error ? 'border-red-900/50' : 'border-slate-700 hover:border-slate-600'}`}
                        >
                          <div className="flex items-center gap-4 overflow-hidden flex-grow">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                              file.error ? 'bg-red-900/30' :
                              file.status === 'pending' ? 'bg-blue-900/30' :
                              file.status === 'complete' ? 'bg-emerald-900/30' :
                              'bg-slate-700'
                            }`}>
                              {file.error ? (
                                <AlertCircle className="w-5 h-5 text-red-500" />
                              ) : file.status === 'idle' ? (
                                <div className="w-3 h-3 rounded-full bg-slate-500"></div>
                              ) : file.status === 'pending' ? (
                                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                              ) : (
                                <CheckCircle className="w-5 h-5 text-emerald-400" />
                              )}
                            </div>
                            <div className="flex flex-col overflow-hidden min-w-0 flex-grow">
                              <span className="text-base font-medium text-slate-200 truncate" title={file.newPath}>
                                {file.newName}
                              </span>
                              <div className="text-xs text-slate-500 mt-1">
                                <span className="truncate" title={file.originalPath}>
                                  <span className="font-semibold text-slate-600">FROM:</span> {file.originalPath}
                                </span>
                                <span className="block text-blue-500 truncate" title={file.newPath}>
                                  <span className="font-semibold text-blue-800">TO:</span> {file.newPath}
                                </span>
                              </div>
                              {file.error && (
                                <span className="text-xs text-red-400 truncate mt-1.5 font-mono" title={file.error}>
                                  {file.error}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0 ml-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            {!file.error && file.status === 'complete' && file.content && (
                              <button 
                                onClick={() => setPreviewFile(file)} 
                                className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-400 transition-colors" 
                                title="Preview"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            <button 
                              onClick={() => removeFile(file.id)} 
                              className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-500 transition-colors" 
                              title="Remove"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setPreviewFile(null)}></div>
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col relative z-10 animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-xl">
              <div className="flex flex-col min-w-0">
                <h3 className="text-white font-mono text-sm truncate" title={previewFile.newPath}>
                  {previewFile.newPath}
                </h3>
                <p className="text-xs text-slate-400 truncate" title={previewFile.originalPath}>
                  Original: {previewFile.originalPath}
                </p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => copyToClipboard(previewFile.content)} 
                  className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs flex items-center gap-2 transition-colors"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <button onClick={() => setPreviewFile(null)} className="text-slate-400 hover:text-white transition-colors p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-grow overflow-auto p-4 bg-[#0d1117] rounded-b-xl">
              <pre className="text-sm text-slate-300 font-mono whitespace-pre-wrap break-all">
                {previewFile.content}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div 
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] sm:w-auto sm:left-auto sm:right-5 sm:translate-x-0 z-50 bg-slate-800 border border-slate-700 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 transition-all duration-300 transform ${toast.show ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0'}`}
      >
        {toast.type === 'error' ? <AlertCircle className="text-red-400 flex-shrink-0" /> : <CheckCircle className="text-emerald-400 flex-shrink-0" />}
        <span className="truncate">{toast.msg}</span>
      </div>

      {/* Custom Scrollbar Styles */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(30, 41, 59, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(100, 116, 139, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.7);
        }
        .hover\:bg-slate-750:hover {
          background-color: rgba(30, 41, 59, 0.9);
        }
      `}</style>
    </div>
  );
};

export default App;