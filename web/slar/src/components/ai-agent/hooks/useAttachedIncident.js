import { useState, useEffect } from 'react';

export const useAttachedIncident = () => {
  const [attachedIncident, setAttachedIncident] = useState(null);

  // Check for attached incident from sessionStorage
  useEffect(() => {
    const attachedIncidentData = sessionStorage.getItem('attachedIncident');
    if (attachedIncidentData) {
      try {
        const incident = JSON.parse(attachedIncidentData);
        setAttachedIncident(incident);
        // Clear from sessionStorage after loading
        sessionStorage.removeItem('attachedIncident');
      } catch (error) {
        console.error('Error parsing attached incident:', error);
      }
    }
  }, []);

  return { attachedIncident, setAttachedIncident };
};
