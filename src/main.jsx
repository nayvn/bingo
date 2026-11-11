import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// StrictMode는 개발 중 effect를 두 번 실행해서 같은 P2P ID로 연결을 두 번 열게 되므로 쓰지 않는다.
createRoot(document.getElementById('root')).render(<App />);
