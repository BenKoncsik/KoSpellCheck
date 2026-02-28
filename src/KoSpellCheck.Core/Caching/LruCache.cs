namespace KoSpellCheck.Core.Caching;

public sealed class LruCache<TKey, TValue> where TKey : notnull
{
    private readonly int _capacity;
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map;
    private readonly LinkedList<(TKey Key, TValue Value)> _list;

    public LruCache(int capacity)
    {
        _capacity = Math.Max(1, capacity);
        _map = new Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>>();
        _list = new LinkedList<(TKey Key, TValue Value)>();
    }

    public bool TryGet(TKey key, out TValue? value)
    {
        if (_map.TryGetValue(key, out var node))
        {
            _list.Remove(node);
            _list.AddFirst(node);
            value = node.Value.Value;
            return true;
        }

        value = default;
        return false;
    }

    public void Set(TKey key, TValue value)
    {
        if (_map.TryGetValue(key, out var existing))
        {
            _list.Remove(existing);
            _map.Remove(key);
        }

        var node = new LinkedListNode<(TKey Key, TValue Value)>((key, value));
        _list.AddFirst(node);
        _map[key] = node;

        if (_map.Count <= _capacity)
        {
            return;
        }

        var tail = _list.Last;
        if (tail == null)
        {
            return;
        }

        _list.RemoveLast();
        _map.Remove(tail.Value.Key);
    }
}
