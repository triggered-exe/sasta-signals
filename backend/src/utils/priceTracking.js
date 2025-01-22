// Function to check if current time is between 12 AM and 6 AM IST
export const isNightTimeIST = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);
    const hours = istTime.getUTCHours();
    return hours >= 0 && hours < 6;
};