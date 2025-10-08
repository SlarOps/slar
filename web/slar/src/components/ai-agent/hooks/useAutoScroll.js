import { useEffect, useRef } from 'react';

export const useAutoScroll = (messages, endRef) => {
  // Tối ưu hóa auto-scroll - chỉ scroll khi có message mới
  const prevMessagesLength = useRef(messages.length);
  
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      // Sử dụng requestAnimationFrame để tối ưu hóa scroll
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      prevMessagesLength.current = messages.length;
    }
  }, [messages.length, endRef]);
};
