import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _info: unknown) {
    console.error('[ErrorBoundary]', error);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            background: '#0a0a0a',
            color: 'rgba(255,255,255,0.74)',
            fontFamily: 'system-ui, sans-serif',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '48px', lineHeight: 1 }}>⚠</div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'rgba(255,255,255,0.92)', margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '14px', maxWidth: '400px', margin: 0 }}>
            {this.state.error?.message ?? 'An unexpected error occurred. Your progress is safe.'}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: '8px',
              padding: '10px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.88)',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
