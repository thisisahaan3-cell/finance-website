import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
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
const Dcf = lazy(() => import('./pages/Dcf'));
const Models = lazy(() => import('./pages/Models'));
const Corporate = lazy(() => import('./pages/Corporate'));
const Invest = lazy(() => import('./pages/Invest'));
const Loan = lazy(() => import('./pages/Loan'));
const Tax = lazy(() => import('./pages/Tax'));
const Retire = lazy(() => import('./pages/Retire'));
const FixedIncome = lazy(() => import('./pages/FixedIncome'));
const NetWorth = lazy(() => import('./pages/NetWorth'));
const Learn = lazy(() => import('./pages/Learn'));
const Glossary = lazy(() => import('./pages/Glossary'));
const Settings = lazy(() => import('./pages/Settings'));
const Home = lazy(() => import('./pages/Home'));

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
  const { pathname } = useLocation();
  return (
    <Layout>
      <Boundary key={pathname}>
        <Suspense fallback={<Loading height={200} />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/valuation/dcf" element={<Dcf />} />
            <Route path="/valuation/models" element={<Models />} />
            <Route path="/corporate" element={<Corporate />} />
            <Route path="/calc/invest" element={<Invest />} />
            <Route path="/calc/loan" element={<Loan />} />
            <Route path="/calc/tax" element={<Tax />} />
            <Route path="/calc/retire" element={<Retire />} />
            <Route path="/calc/fixed-income" element={<FixedIncome />} />
            <Route path="/networth" element={<NetWorth />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/learn/:id" element={<Learn />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/settings" element={<Settings />} />
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
