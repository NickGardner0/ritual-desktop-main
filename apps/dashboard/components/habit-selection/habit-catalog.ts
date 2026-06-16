import {
  productivityHabits,
  fitnessHealthHabits,
  educationHabits,
  experimentsHabits,
} from '../../data/habits-data';

export function getHabitsForCategory(category: string) {
    switch (category) {
      case 'applewatch':
        return [
          // Activity
          { value: '_section_activity', label: 'Activity', section: true },
          { value: 'steps', label: 'Steps', metric_type: 'steps', unit: 'Steps' },
          { value: 'active-energy', label: 'Active Calories', metric_type: 'active_energy', unit: 'Calories' },
          { value: 'basal-energy', label: 'Resting Calories', metric_type: 'basal_energy', unit: 'Calories' },
          { value: 'distance', label: 'Distance', metric_type: 'distance', unit: 'Miles' },
          { value: 'flights-climbed', label: 'Flights Climbed', metric_type: 'flights_climbed', unit: 'Count' },
          { value: 'exercise-time', label: 'Exercise Minutes', metric_type: 'exercise_time', unit: 'Minutes' },
          { value: 'stand-time', label: 'Stand Time', metric_type: 'stand_time', unit: 'Minutes' },
          // Heart
          { value: '_section_heart', label: 'Heart', section: true },
          { value: 'heart-rate', label: 'Heart Rate', metric_type: 'hr', unit: 'BPM' },
          { value: 'hrv', label: 'Heart Rate Variability (HRV)', metric_type: 'hrv', unit: 'HRV' },
          { value: 'resting-hr', label: 'Resting Heart Rate', metric_type: 'resting_hr', unit: 'BPM' },
          { value: 'walking-hr', label: 'Walking Heart Rate', metric_type: 'walking_hr', unit: 'BPM' },
          // Sleep & Recovery
          { value: '_section_sleep', label: 'Sleep & Recovery', section: true },
          { value: 'sleep', label: 'Sleep Duration', metric_type: 'sleep_session', unit: 'Hours Slept' },
          { value: 'sleep-rem', label: 'REM Sleep', metric_type: 'sleep_rem', unit: 'Minutes' },
          { value: 'sleep-deep', label: 'Deep Sleep', metric_type: 'sleep_deep', unit: 'Minutes' },
          { value: 'sleep-core', label: 'Core Sleep', metric_type: 'sleep_core', unit: 'Minutes' },
          // Respiratory & Blood
          { value: '_section_respiratory', label: 'Respiratory & Blood', section: true },
          { value: 'blood-oxygen', label: 'Blood Oxygen (SpO2)', metric_type: 'oxygen_saturation', unit: 'Percentage' },
          { value: 'respiratory-rate', label: 'Respiratory Rate', metric_type: 'respiratory_rate', unit: 'Count' },
          // Mobility
          { value: '_section_mobility', label: 'Mobility', section: true },
          { value: 'walking-speed', label: 'Walking Speed', metric_type: 'walking_speed', unit: 'm/s' },
          { value: 'step-length', label: 'Step Length', metric_type: 'walking_step_length', unit: 'cm' },
          { value: 'walking-asymmetry', label: 'Walking Asymmetry', metric_type: 'walking_asymmetry', unit: 'Percentage' },
          // Workouts & Mindfulness
          { value: '_section_workouts', label: 'Workouts & Mindfulness', section: true },
          { value: 'workouts', label: 'Workouts', metric_type: 'workout', unit: 'Count' },
          { value: 'mindful-minutes', label: 'Mindful Minutes', metric_type: 'mindful_minutes', unit: 'Minutes' },
        ];
      case 'oura':
        return [
          { value: 'sleep-score', label: 'Sleep Score' },
          { value: 'readiness', label: 'Readiness Score' },
          { value: 'activity', label: 'Activity Score' }
        ];
      case 'whoop':
        return [
          { value: 'recovery', label: 'Recovery Score', metric_type: 'recovery_score', unit: 'Count' },
          { value: 'sleep-duration', label: 'Sleep Duration', metric_type: 'sleep_total', unit: 'Hours' },
          { value: 'sleep-performance', label: 'Sleep Performance' },
          { value: 'bedtime', label: 'Bedtime' },
          { value: 'wake-time', label: 'Wake Time' },
          { value: 'heart-rate', label: 'Heart Rate', metric_type: 'heart_rate', unit: 'BPM' },
          { value: 'strain', label: 'Daily Strain', metric_type: 'strain_score', unit: 'Count' },
          { value: 'resting-hr', label: 'Resting Heart Rate', metric_type: 'resting_heart_rate', unit: 'BPM' },
          { value: 'hrv', label: 'Heart Rate Variability (HRV)', metric_type: 'hrv', unit: 'HRV' },
          { value: 'steps', label: 'Daily Steps', metric_type: 'steps', unit: 'Steps' }
        ];
      case 'fitbit':
        return [
          { value: 'steps', label: 'Daily Steps' },
          { value: 'heart-rate', label: 'Heart Rate' },
          { value: 'sleep', label: 'Sleep Duration' },
          { value: 'active-minutes', label: 'Active Minutes' },
          { value: 'calories', label: 'Calories Burned' },
          { value: 'distance', label: 'Distance' }
        ];
      case 'garmin':
        return [
          { value: 'vo2-max', label: 'VO2 Max' },
          { value: 'training-load', label: 'Training Load' },
          { value: 'body-battery', label: 'Body Battery' }
        ];
      case 'plaid':
        return [
          { value: 'spending', label: 'Daily Spending', metric_type: 'spending', unit: 'Dollars' },
          { value: 'income', label: 'Income', metric_type: 'income', unit: 'Dollars' },
          { value: 'savings', label: 'Savings Rate', metric_type: 'savings_rate', unit: 'Percentage' },
        ];
      case 'productivity':
        return productivityHabits || [];
      case 'fitness':
        return fitnessHealthHabits || [];
      case 'education':
        return educationHabits || [];
      case 'experiments':
        return experimentsHabits || [];
      default:
        return [];
    }
  };
