# AI Agent Components

Thư mục này chứa các component được tách ra từ AI Agent page để dễ bảo trì và tái sử dụng.

## Cấu trúc thư mục

```
ai-agent/
├── README.md                 # File này
├── index.js                  # Export tất cả components
├── Badge.js                  # Component Badge nhỏ
├── ChatHeader.js             # Header của chat
├── MessageComponent.js       # Component hiển thị từng message
├── MessagesList.js           # Component hiển thị danh sách messages
├── utils.js                  # Utility functions (statusColor, severityColor)
└── hooks/                    # Custom hooks
    ├── index.js              # Export tất cả hooks
    ├── useWebSocket.js       # Hook quản lý WebSocket connection
    ├── useChatHistory.js     # Hook load chat history
    ├── useAutoScroll.js      # Hook auto-scroll tối ưu
    ├── useAttachedIncident.js # Hook quản lý attached incident
    └── useChatSubmit.js      # Hook xử lý submit message
```

## Components

### 1. **ChatHeader**
- Hiển thị header của chat với connection status
- Props: `connectionStatus`

### 2. **MessagesList** 
- Hiển thị danh sách messages với virtualization
- Bao gồm typing indicator
- Props: `messages`, `isSending`, `endRef`

### 3. **MessageComponent**
- Component hiển thị từng message riêng lẻ
- Được memoize để tối ưu performance
- Hỗ trợ Markdown, Memory Query Events, incidents
- Props: `message`

### 4. **Badge**
- Component badge nhỏ để hiển thị status/tags
- Props: `children`, `color`

## Custom Hooks

### 1. **useWebSocket**
- Quản lý WebSocket connection
- Xử lý các message types khác nhau
- Return: `{ wsConnection, connectionStatus }`

### 2. **useChatHistory**
- Load chat history khi component mount
- Xử lý fallback message nếu không có history

### 3. **useAutoScroll**
- Tối ưu auto-scroll chỉ khi có message mới
- Sử dụng requestAnimationFrame

### 4. **useAttachedIncident**
- Quản lý incident được attach từ sessionStorage
- Return: `{ attachedIncident, setAttachedIncident }`

### 5. **useChatSubmit**
- Xử lý logic submit message
- Bao gồm incident context nếu có
- Return: `{ onSubmit }`

## Utilities

### statusColor(status)
Trả về CSS classes cho status colors

### severityColor(severity)
Trả về CSS classes cho severity colors

## Cách sử dụng

```jsx
import { 
  ChatHeader, 
  MessagesList, 
  useWebSocket,
  useChatHistory,
  useAutoScroll,
  useAttachedIncident,
  useChatSubmit
} from '../../components/ai-agent';

function AIAgentPage() {
  // State
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef(null);

  // Custom hooks
  const { wsConnection, connectionStatus } = useWebSocket(session, setMessages, setIsSending);
  const { attachedIncident, setAttachedIncident } = useAttachedIncident();
  const { onSubmit } = useChatSubmit(/* params */);
  
  useChatHistory(setMessages);
  useAutoScroll(messages, endRef);

  return (
    <div>
      <ChatHeader connectionStatus={connectionStatus} />
      <MessagesList messages={messages} isSending={isSending} endRef={endRef} />
      {/* ChatInput */}
    </div>
  );
}
```

## Lợi ích của việc tách component

1. **Dễ bảo trì**: Mỗi component có trách nhiệm rõ ràng
2. **Tái sử dụng**: Có thể sử dụng lại trong các page khác
3. **Testing**: Dễ dàng test từng component riêng lẻ
4. **Performance**: Memoization và optimization tốt hơn
5. **Code organization**: Code được tổ chức rõ ràng theo chức năng

## Performance Optimizations

- **React.memo()**: Tránh re-render không cần thiết
- **useMemo()**: Cache expensive calculations
- **useCallback()**: Cache functions
- **Message virtualization**: Giới hạn số messages hiển thị
- **Optimized auto-scroll**: Chỉ scroll khi cần thiết
