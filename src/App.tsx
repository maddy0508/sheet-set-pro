import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppStoreProvider } from '@/data/store';
import { AppShell } from '@/layout/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { Customers } from '@/pages/Customers';
import { Jobs } from '@/pages/Jobs';
import { JobWorkspace } from '@/pages/JobWorkspace';
import { CataloguePage } from '@/pages/Catalogue';
import { SettingsPage } from '@/pages/Settings';

export default function App() {
  return (
    <AppStoreProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="customers" element={<Customers />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:jobId" element={<JobWorkspace />} />
            <Route path="catalogue" element={<CataloguePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <strong>Page not found</strong>
                  <p>The page you requested does not exist.</p>
                </div>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppStoreProvider>
  );
}
