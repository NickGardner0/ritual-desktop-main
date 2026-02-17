// Comprehensive habit tracking options with 150+ per category

export interface Habit {
  value: string;
  label: string;
  category: string;
}

export const productivityHabits: Habit[] = [
  { value: 'deep-work', label: 'Deep Work', category: 'productivity' },
  { value: 'time-blocking', label: 'Time Blocking', category: 'productivity' },
  { value: 'daily-planning', label: 'Daily Planning', category: 'productivity' },
  { value: 'phone-screen-time', label: 'Phone Screen Time', category: 'productivity' },
  { value: 'side-project', label: 'Side Project', category: 'productivity' },
  { value: 'computer-screen-time', label: 'Computer Screen Time', category: 'productivity' },
  { value: 'morning-routine', label: 'Morning Routine', category: 'productivity' },
  { value: 'night-routine', label: 'Night Routine', category: 'productivity' },
  { value: 'focus-time', label: 'Focus Time', category: 'productivity' },
  { value: 'meditation', label: 'Meditation', category: 'productivity' },
];


export const fitnessHealthHabits: Habit[] = [
  { value: 'daily-steps', label: 'Daily Steps', category: 'fitness' },
  { value: 'weight-lifting', label: 'Weight Lifting', category: 'fitness' },
  { value: 'heart-rate', label: 'Heart Rate', category: 'fitness' },
  { value: 'blood-oxygen', label: 'Blood Oxygen Level', category: 'fitness' },
  { value: 'body-weight', label: 'Body Weight', category: 'fitness' },
  { value: 'protein-intake', label: 'Protein Intake', category: 'fitness' },
  { value: 'running', label: 'Running', category: 'fitness' },
  { value: 'water-intake', label: 'Water Intake', category: 'fitness' },
  { value: 'cardio', label: 'Cardio', category: 'fitness' },
  { value: 'daily-stretching', label: 'Daily Stretching', category: 'fitness' },
  { value: 'yoga', label: 'Yoga', category: 'fitness' },
  { value: 'walking', label: 'Walking', category: 'fitness' },
  { value: 'sports-practice', label: 'Sports Practice', category: 'fitness' },
  { value: 'calories-consumed', label: 'Calories Consumed', category: 'fitness' },
];


export const educationHabits: Habit[] = [
  { value: 'daily-reading', label: 'Daily Reading', category: 'education' },
  { value: 'note-taking', label: 'Note Taking', category: 'education' },
  { value: 'study-session', label: 'Study Session', category: 'education' },
  { value: 'leetcode-practice', label: 'Leetcode Practice', category: 'education' },
  { value: 'online-course', label: 'Online Course', category: 'education' },
  { value: 'programming', label: 'Programming', category: 'education' },
  { value: 'daily-writing', label: 'Daily Writing', category: 'education' },
  { value: 'research', label: 'Research', category: 'education' },
  { value: 'homework', label: 'Homework', category: 'education' },
  { value: 'practice-problems', label: 'Practice Problems', category: 'education' },
  { value: 'learning-language', label: 'Learning a New Language', category: 'education' },
];


export const experimentsHabits: Habit[] = [
  { value: 'intermittent-fasting', label: 'Intermittent Fasting', category: 'experiments' },
  { value: 'caffeine-intake', label: 'Caffeine Intake', category: 'experiments' },
  { value: 'cold-exposure', label: 'Cold Exposure', category: 'experiments' },
  { value: 'sauna-session', label: 'Sauna Session', category: 'experiments' },
  { value: 'new-supplement', label: 'New Supplement', category: 'experiments' },
  { value: 'quit-smoking', label: 'Quit Smoking', category: 'experiments' },
  { value: 'digital-detox', label: 'Digital Detox', category: 'experiments' },
  { value: 'no-alcohol', label: 'No Alcohol', category: 'experiments' },
  { value: 'experimental-drugs', label: 'Experimental Drugs', category: 'experiments' },
];
