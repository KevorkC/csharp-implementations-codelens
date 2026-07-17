using System;

namespace Sample
{
    // Expect: "2 implementations" on IGreeter and on each of its members.
    public interface IGreeter
    {
        string Name { get; }

        event EventHandler? Greeted;

        string Greet(string who);
    }

    public class EnglishGreeter : IGreeter
    {
        public string Name => "English";

        public event EventHandler? Greeted;

        public string Greet(string who)
        {
            Greeted?.Invoke(this, EventArgs.Empty);
            return $"Hello, {who}!";
        }
    }

    public class DanishGreeter : IGreeter
    {
        public string Name => "Danish";

        public event EventHandler? Greeted;

        public string Greet(string who)
        {
            Greeted?.Invoke(this, EventArgs.Empty);
            return $"Hej, {who}!";
        }
    }

    // Expect: "1 implementation" on the class, on Greet, and on Farewell.
    // Expect: no lens on Plain.
    public abstract class GreeterBase
    {
        public abstract string Greet(string who);

        public virtual string Farewell(string who) => $"Goodbye, {who}.";

        public string Plain() => "no lens here";
    }

    // Expect: no lens on the override members.
    public class LoudGreeter : GreeterBase
    {
        public override string Greet(string who) => $"HELLO {who.ToUpperInvariant()}!!";

        public override string Farewell(string who) => $"BYE {who.ToUpperInvariant()}!";
    }
}
