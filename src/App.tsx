import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';

const PortfolioList = lazy(() => import('./pages/portfolio/PortfolioList'));
const Studio = lazy(() => import('./pages/portfolio/Studio'));
const Markets = lazy(() => import('./pages/Markets'));
const Stock = lazy(() => import('./pages/Stock'));
const Screener = lazy(() => import('./pages/Screener'));
const Compare = lazy(() => import('./pages/Compare'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Currency = lazy(() => import('./pages/Currency'));
const Optimizer = lazy(() => import('./pages/Optimizer'));
const Backtest = lazy(() => import('./pages/Backtest'));
const RiskLab = lazy(() => import('./pages/RiskLab'));
const Simulate = lazy(() => import('./pages/Simulate'));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="note err" role="alert">
        <p>
          <b>This page hit an error and stopped.</b> Your saved data is safe.
        </p>
        <p className="mono small">{this.state.error.message}</p>
        <button className="btn sm" onClick={() => location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}

function NotFound() {
  return (
    <div className="empty">
      <h3>Page not found</h3>
      <p>That address does not match any tool.</p>
      <Link className="btn primary" to="/">
        Go to the home page
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Boundary>
        <Suspense fallback={<Loading height={200} />}>
          <Routes>
            <Route path="/markets" element={<Markets />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/stock/:symbol" element={<Stock />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/currency" element={<Currency />} />
            <Route path="/optimizer" element={<Optimizer />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/risk" element={<RiskLab />} />
            <Route path="/simulate" element={<Simulate />} />
            <Route path="/portfolio" element={<PortfolioList />} />
            <Route path="/portfolio/:id" element={<Studio />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Boundary>
    </Layout>
  );
}
