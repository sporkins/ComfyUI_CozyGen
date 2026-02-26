import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import MainPage from './pages/MainPage';
import Gallery from './pages/Gallery';
import HistoryTab from './components/HistoryTab';
import HistoryDetail from './pages/HistoryDetail';
import QueueTab from './components/QueueTab';
import LogsTab from './components/LogsTab';

function App() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<MainPage />} />
                    <Route path="gallery" element={<Gallery />} />
                    <Route path="history" element={<HistoryTab />} />
                    <Route path="history/:historyId" element={<HistoryDetail />} />
                    <Route path="queue" element={<QueueTab />} />
                    <Route path="logs" element={<LogsTab />} />
                </Route>
            </Routes>
        </HashRouter>
    );
}

export default App;
