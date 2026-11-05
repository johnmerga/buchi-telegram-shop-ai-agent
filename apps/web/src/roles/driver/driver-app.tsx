import { SignInGate } from '../../components/sign-in-gate';
import { BoardScreen } from './board-screen';

/** Drivers work only inside Telegram, where their jobs and alerts also arrive. */
export function DriverApp() {
  return (
    <SignInGate browserSignIn={false}>
      <BoardScreen />
    </SignInGate>
  );
}
