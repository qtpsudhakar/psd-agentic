export interface IEmployeeData {
  firstName: string;
  lastName: string;
}

export function generateEmployeeData(): IEmployeeData {
  const timestamp = new Date().getTime();
  return {
    firstName: `first_${timestamp}`,
    lastName: `last_${timestamp}`,
  };
}
