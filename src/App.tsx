import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';

const PortfolioList = lazy(() => import('./pages/portfolio/PortfolioList'));
const Studio = lazy(() => import('./pages/portfolio/Studio'));

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
            <Route path="/portfolio" element={<PortfolioList />} />
            <Route path="/portfolio/:id" element={<Studio />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Boundary>
    </Layout>
  );
}
