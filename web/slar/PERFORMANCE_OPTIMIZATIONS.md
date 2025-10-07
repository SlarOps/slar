# Performance Optimizations for AI Agent Chat

## Vấn đề ban đầu
Khi có nhiều messages trong chat, page chạy rất chậm và gần như không thể type message mới được.

## Các tối ưu hóa đã thực hiện

### 1. **Memoized Message Component**
- Tạo `MessageComponent` được wrap bằng `React.memo()` để tránh re-render không cần thiết
- Memoize `markdownComponents` bằng `useMemo()` để tránh tạo lại object mỗi lần render

### 2. **Optimized Auto-scroll**
- Thay đổi từ `useEffect(() => {}, [messages])` thành `useEffect(() => {}, [messages.length])`
- Chỉ scroll khi có message mới (length tăng), không scroll khi messages thay đổi nội dung
- Sử dụng `requestAnimationFrame()` để tối ưu hóa scroll animation

### 3. **Message Virtualization**
- Giới hạn số lượng messages hiển thị tối đa là 50 messages
- Khi vượt quá, chỉ hiển thị 5 messages đầu + thông báo + 45 messages gần nhất
- Sử dụng `useMemo()` để tính toán `visibleMessages`

### 4. **Stable Keys**
- Thay đổi từ `key={idx}` thành `key={message.role}-${idx}-${message.content?.slice(0, 50)}`
- Giúp React identify chính xác components và tránh re-render không cần thiết

### 5. **Callback Optimization**
- Wrap `onSubmit` function bằng `useCallback()` với dependencies rõ ràng
- Wrap các event handlers trong ChatInput bằng `useCallback()`

### 6. **Import Optimization**
- Thêm `useMemo`, `useCallback`, `memo` vào imports để sử dụng React optimization hooks

## Kết quả mong đợi

### Trước khi tối ưu:
- ❌ Re-render toàn bộ messages mỗi khi có message mới
- ❌ Scroll animation chạy mỗi khi messages thay đổi
- ❌ Markdown components được tạo lại mỗi lần render
- ❌ Hiển thị tất cả messages (có thể hàng trăm/nghìn messages)

### Sau khi tối ưu:
- ✅ Chỉ re-render messages thực sự thay đổi
- ✅ Scroll chỉ khi có message mới
- ✅ Markdown components được cache
- ✅ Giới hạn messages hiển thị để tránh DOM quá lớn
- ✅ Stable keys giúp React optimize reconciliation
- ✅ Functions được memoize để tránh re-creation

## Monitoring Performance

Để kiểm tra hiệu suất, có thể:

1. **React DevTools Profiler**: Đo thời gian render
2. **Browser DevTools**: Kiểm tra memory usage và FPS
3. **Console timing**: Thêm `console.time()` để đo specific operations

## Các tối ưu hóa tiếp theo có thể thực hiện

1. **Virtual Scrolling**: Sử dụng thư viện như `react-window` hoặc `react-virtualized`
2. **Message Pagination**: Load messages theo batch thay vì load tất cả
3. **Image Lazy Loading**: Lazy load images trong messages
4. **Web Workers**: Xử lý markdown parsing trong web worker
5. **IndexedDB**: Cache messages locally để giảm API calls

## Code Example

```jsx
// Before: Re-renders all messages
{messages.map((m, idx) => (
  <div key={idx}>...</div>
))}

// After: Optimized with memoization and virtualization
{visibleMessages.map((message, idx) => (
  <MessageComponent 
    key={`${message.role}-${idx}-${message.content?.slice(0, 50)}`} 
    message={message} 
  />
))}
```
